
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

const allowedStatuses = ["draft", "active", "paused", "completed"];
const allowedEvents = ["view", "click", "enquiry", "engagement"];

const number = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const text = (value, max = 500) =>
  String(value ?? "").trim().slice(0, max);

async function getUser(DB, request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)boostly_session=([^;]+)/);

  if (!match) {
    return {
      error: "Not logged in. Please log in.",
      status: 401
    };
  }

  const session = await DB.prepare(`
    SELECT user_id FROM sessions
    WHERE id = ? AND expires_at > datetime('now')
    LIMIT 1
  `).bind(match[1]).first();

  if (!session) {
    return {
      error: "Session expired. Please log in again.",
      status: 401
    };
  }

  const userId = Number(session.user_id);

  const business = await DB.prepare(`
    SELECT id FROM businesses
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).bind(userId).first();

  if (!business) {
    return {
      error: "Business profile not found for this login.",
      status: 403
    };
  }

  return {
    userId,
    businessId: Number(business.id)
  };
}

async function ownedCampaign(DB, campaignId, user) {
  return DB.prepare(`
    SELECT * FROM campaigns
    WHERE id = ?
      AND user_id = ?
      AND business_id = ?
    LIMIT 1
  `).bind(
    campaignId,
    user.userId,
    user.businessId
  ).first();
}

async function campaignMetrics(DB, campaignIds) {
  const map = new Map();

  for (const id of campaignIds) {
    map.set(Number(id), {
      views: 0,
      clicks: 0,
      enquiries: 0,
      engagements: 0
    });
  }

  if (!campaignIds.length) return map;

  const placeholders = campaignIds.map(() => "?").join(",");

  const rows = await DB.prepare(`
    SELECT
      campaign_id,
      SUM(CASE WHEN event_type = 'view' THEN 1 ELSE 0 END) AS views,
      SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) AS clicks,
      SUM(CASE WHEN event_type = 'enquiry' THEN 1 ELSE 0 END) AS enquiries,
      SUM(CASE WHEN event_type = 'engagement' THEN 1 ELSE 0 END) AS engagements
    FROM campaign_center_events
    WHERE campaign_id IN (${placeholders})
    GROUP BY campaign_id
  `).bind(...campaignIds).all();

  for (const row of rows.results || []) {
    map.set(Number(row.campaign_id), {
      views: Number(row.views || 0),
      clicks: Number(row.clicks || 0),
      enquiries: Number(row.enquiries || 0),
      engagements: Number(row.engagements || 0)
    });
  }

  return map;
}

async function trackEvent(DB, request) {
  const body = await request.json();

  const campaignId = number(body.campaign_id, -1);
  const eventType = text(body.event_type, 30).toLowerCase();
  const eventKey = text(body.event_key, 128);

  if (
    !Number.isInteger(campaignId) ||
    campaignId < 1 ||
    !allowedEvents.includes(eventType)
  ) {
    return json({
      success: false,
      error: "Invalid campaign ID or event type."
    }, 400);
  }

  const campaign = await DB.prepare(`
    SELECT id, business_id
    FROM campaigns
    WHERE id = ?
      AND status IN ('active','open','published')
    LIMIT 1
  `).bind(campaignId).first();

  if (!campaign) {
    return json({
      success: false,
      error: "Campaign not found or not active."
    }, 404);
  }

  try {
    await DB.prepare(`
      INSERT INTO campaign_center_events (
        campaign_id,
        business_id,
        event_type,
        event_key
      )
      VALUES (?, ?, ?, ?)
    `).bind(
      campaignId,
      Number(campaign.business_id),
      eventType,
      eventKey || null
    ).run();

  } catch (error) {
    if (
      eventKey &&
      String(error?.message || "").toLowerCase().includes("unique")
    ) {
      return json({
        success: true,
        duplicate: true,
        message: "Event already recorded."
      });
    }

    throw error;
  }

  return json({
    success: true,
    message: "Event recorded."
  }, 201);
}

async function handle(context) {
  const { request, env } = context;
  const DB = env.DB;

  if (!DB) {
    return json({
      success: false,
      error: "D1 database binding DB is missing."
    }, 500);
  }

  try {
    const method = request.method.toUpperCase();
    const url = new URL(request.url);

    // Public event tracking is the only unauthenticated operation.
    if (method === "POST") {
      let body;

      try {
        body = await request.clone().json();
      } catch {
        body = {};
      }

      if (body.action === "track") {
        return await trackEvent(DB, request);
      }
    }

    const user = await getUser(DB, request);

    if (user.error) {
      return json({
        success: false,
        error: user.error
      }, user.status);
    }

    // GET: Fetch campaigns and metrics.
    if (method === "GET") {
      const requestedId = number(
        url.searchParams.get("campaign_id"),
        0
      );

      if (requestedId) {
        const campaign = await ownedCampaign(
          DB,
          requestedId,
          user
        );

        if (!campaign) {
          return json({
            success: false,
            error: "Campaign not found or access denied."
          }, 404);
        }

        const metrics = await campaignMetrics(
          DB,
          [requestedId]
        );

        return json({
          success: true,
          campaign: {
            ...campaign,
            metrics: metrics.get(requestedId)
          }
        });
      }

      const result = await DB.prepare(`
        SELECT * FROM campaigns
        WHERE user_id = ?
          AND business_id = ?
        ORDER BY created_at DESC, id DESC
      `).bind(
        user.userId,
        user.businessId
      ).all();

      const rows = result.results || [];

      const metricMap = await campaignMetrics(
        DB,
        rows.map(row => Number(row.id))
      );

      const campaigns = rows.map(row => ({
        ...row,
        metrics: metricMap.get(Number(row.id)) || {
          views: 0,
          clicks: 0,
          enquiries: 0,
          engagements: 0
        }
      }));

      const totals = campaigns.reduce((sum, row) => {
        for (const key of [
          "views",
          "clicks",
          "enquiries",
          "engagements"
        ]) {
          sum[key] += row.metrics[key];
        }

        return sum;
      }, {
        views: 0,
        clicks: 0,
        enquiries: 0,
        engagements: 0
      });

      return json({
        success: true,
        campaigns,
        totals,
        count: campaigns.length
      });
    }

    // POST: Create campaign.
    if (method === "POST") {
      const body = await request.json();

      const campaignName = text(body.campaign_name, 120);
      const goal = text(body.goal, 80);
      const budget = number(body.budget, -1);
      const duration = number(body.duration, -1);
      const audience = text(body.audience, 500);
      const description = text(body.description, 3000);
      const status = text(
        body.status || "draft",
        30
      ).toLowerCase();

      if (!campaignName || !goal) {
        return json({
          success: false,
          error: "Campaign name and goal are required."
        }, 400);
      }

      if (
        budget < 0 ||
        budget > 100000000 ||
        !Number.isFinite(budget)
      ) {
        return json({
          success: false,
          error: "Budget must be between ₹0 and ₹10,00,00,000."
        }, 400);
      }

      if (
        !Number.isInteger(duration) ||
        duration < 1 ||
        duration > 365
      ) {
        return json({
          success: false,
          error: "Duration must be between 1 and 365 days."
        }, 400);
      }

      if (!allowedStatuses.includes(status)) {
        return json({
          success: false,
          error: "Invalid campaign status."
        }, 400);
      }

      const result = await DB.prepare(`
        INSERT INTO campaigns (
          user_id,
          business_id,
          campaign_name,
          goal,
          budget,
          duration,
          audience,
          description,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        user.userId,
        user.businessId,
        campaignName,
        goal,
        budget,
        duration,
        audience,
        description,
        status
      ).run();

      return json({
        success: true,
        message: "Campaign created.",
        campaign_id: Number(result.meta?.last_row_id || 0)
      }, 201);
    }

    // PATCH: Edit campaign or update status.
    if (method === "PATCH") {
      const body = await request.json();

      // Accept campaign_id from query string OR JSON body.
      const campaignId = number(
        url.searchParams.get("campaign_id") || body.campaign_id,
        -1
      );

      if (!Number.isInteger(campaignId) || campaignId < 1) {
        return json({
          success: false,
          error: "Valid campaign ID is required."
        }, 400);
      }

      const existing = await ownedCampaign(
        DB,
        campaignId,
        user
      );

      if (!existing) {
        return json({
          success: false,
          error: "Campaign not found or access denied."
        }, 404);
      }

      const fields = [];
      const values = [];

      if (body.campaign_name !== undefined) {
        const value = text(body.campaign_name, 120);

        if (!value) {
          return json({
            success: false,
            error: "Campaign name cannot be empty."
          }, 400);
        }

        fields.push("campaign_name = ?");
        values.push(value);
      }

      if (body.goal !== undefined) {
        const value = text(body.goal, 80);

        if (!value) {
          return json({
            success: false,
            error: "Campaign goal cannot be empty."
          }, 400);
        }

        fields.push("goal = ?");
        values.push(value);
      }

      if (body.budget !== undefined) {
        const value = number(body.budget, -1);

        if (value < 0 || value > 100000000) {
          return json({
            success: false,
            error: "Invalid budget."
          }, 400);
        }

        fields.push("budget = ?");
        values.push(value);
      }

      if (body.duration !== undefined) {
        const value = number(body.duration, -1);

        if (
          !Number.isInteger(value) ||
          value < 1 ||
          value > 365
        ) {
          return json({
            success: false,
            error: "Duration must be between 1 and 365 days."
          }, 400);
        }

        fields.push("duration = ?");
        values.push(value);
      }

      if (body.audience !== undefined) {
        fields.push("audience = ?");
        values.push(text(body.audience, 500));
      }

      if (body.description !== undefined) {
        fields.push("description = ?");
        values.push(text(body.description, 3000));
      }

      if (body.status !== undefined) {
        const status = text(
          body.status,
          30
        ).toLowerCase();

        if (!allowedStatuses.includes(status)) {
          return json({
            success: false,
            error: "Invalid campaign status."
          }, 400);
        }

        fields.push("status = ?");
        values.push(status);
      }

      if (!fields.length) {
        return json({
          success: false,
          error: "No campaign fields supplied."
        }, 400);
      }

      fields.push("updated_at = datetime('now')");

      await DB.prepare(`
        UPDATE campaigns
        SET ${fields.join(", ")}
        WHERE id = ?
          AND user_id = ?
          AND business_id = ?
      `).bind(
        ...values,
        campaignId,
        user.userId,
        user.businessId
      ).run();

      return json({
        success: true,
        message: "Campaign updated."
      });
    }

    // DELETE: Delete campaign if it has no applications.
    if (method === "DELETE") {
      const campaignId = number(
        url.searchParams.get("campaign_id"),
        -1
      );

      if (!Number.isInteger(campaignId) || campaignId < 1) {
        return json({
          success: false,
          error: "Valid campaign_id is required."
        }, 400);
      }

      const existing = await ownedCampaign(
        DB,
        campaignId,
        user
      );

      if (!existing) {
        return json({
          success: false,
          error: "Campaign not found or access denied."
        }, 404);
      }

      const applications = await DB.prepare(`
        SELECT COUNT(*) AS total
        FROM campaign_applications
        WHERE campaign_id = ?
      `).bind(campaignId).first();

      if (Number(applications?.total || 0) > 0) {
        return json({
          success: false,
          error: "This campaign has creator applications. Complete or close it instead of deleting it.",
          application_count: Number(applications.total)
        }, 409);
      }

      await DB.batch([
        DB.prepare(`
          DELETE FROM campaign_center_events
          WHERE campaign_id = ?
        `).bind(campaignId),

        DB.prepare(`
          DELETE FROM campaigns
          WHERE id = ?
            AND user_id = ?
            AND business_id = ?
        `).bind(
          campaignId,
          user.userId,
          user.businessId
        )
      ]);

      return json({
        success: true,
        message: "Campaign deleted."
      });
    }

    return json({
      success: false,
      error: "Method not allowed."
    }, 405);

  } catch (error) {
    return json({
      success: false,
      error: "Server error.",
      detail: error?.message || "Unknown error"
    }, 500);
  }
}

export async function onRequest(context) {
  return handle(context);
}
