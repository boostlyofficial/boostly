
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

const allowedStatuses = [
  "draft",
  "active",
  "paused",
  "completed"
];

const allowedEvents = [
  "view",
  "click",
  "enquiry",
  "engagement"
];

const number = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const text = (value, max = 500) =>
  String(value ?? "").trim().slice(0, max);

async function ensureEventsTable(DB) {
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS campaign_center_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      business_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      event_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await DB.prepare(`
    CREATE INDEX IF NOT EXISTS
    idx_campaign_center_events_campaign
    ON campaign_center_events(campaign_id)
  `).run();

  await DB.prepare(`
    CREATE INDEX IF NOT EXISTS
    idx_campaign_center_events_type
    ON campaign_center_events(campaign_id, event_type)
  `).run();

  await DB.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS
    idx_campaign_center_events_unique
    ON campaign_center_events(campaign_id, event_type, event_key)
    WHERE event_key IS NOT NULL
  `).run();
}

async function getUser(DB, request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(
    /(?:^|;\s*)boostly_session=([^;]+)/
  );

  if (!match) {
    return {
      error: "Not logged in",
      status: 401
    };
  }

  const sessionId = match[1];

  const session = await DB.prepare(`
    SELECT user_id
    FROM sessions
    WHERE id = ?
      AND expires_at > datetime('now')
    LIMIT 1
  `).bind(sessionId).first();

  if (!session) {
    return {
      error: "Session expired. Please login again.",
      status: 401
    };
  }

  const userId = Number(session.user_id);

  const business = await DB.prepare(`
    SELECT id
    FROM businesses
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).bind(userId).first();

  if (!business) {
    return {
      error: "Business profile not found",
      status: 403
    };
  }

  return {
    userId,
    businessId: Number(business.id)
  };
}

async function getOwnedCampaign(DB, id, user) {
  return DB.prepare(`
    SELECT *
    FROM campaigns
    WHERE id = ?
      AND user_id = ?
      AND business_id = ?
    LIMIT 1
  `).bind(id, user.userId, user.businessId).first();
}

async function getMetrics(DB, campaignId) {
  const result = await DB.prepare(`
    SELECT
      COUNT(CASE WHEN event_type = 'view' THEN 1 END) AS views,
      COUNT(CASE WHEN event_type = 'click' THEN 1 END) AS clicks,
      COUNT(CASE WHEN event_type = 'enquiry' THEN 1 END) AS enquiries,
      COUNT(CASE WHEN event_type = 'engagement' THEN 1 END) AS engagements
    FROM campaign_center_events
    WHERE campaign_id = ?
  `).bind(campaignId).first();

  return {
    views: Number(result?.views || 0),
    clicks: Number(result?.clicks || 0),
    enquiries: Number(result?.enquiries || 0),
    engagements: Number(result?.engagements || 0)
  };
}

async function handleRequest(context) {
  const { request, env } = context;
  const DB = env.DB;

  if (!DB) {
    return json({
      success: false,
      error: "D1 database binding DB is missing"
    }, 500);
  }

  try {
    await ensureEventsTable(DB);

    const method = request.method.toUpperCase();
    const url = new URL(request.url);

    // PUBLIC EVENT TRACKING
    // Events are accepted only for active campaigns.
    if (method === "POST") {
      const body = await request.json();

      if (body.action === "track") {
        const campaignId = number(body.campaign_id);
        const eventType = text(body.event_type, 30).toLowerCase();
        const eventKey = text(body.event_key, 128);

        if (
          !Number.isInteger(campaignId) ||
          campaignId < 1 ||
          !allowedEvents.includes(eventType)
        ) {
          return json({
            success: false,
            error: "Invalid campaign or event type"
          }, 400);
        }

        const campaign = await DB.prepare(`
          SELECT id, business_id
          FROM campaigns
          WHERE id = ?
            AND status IN ('active', 'open', 'published')
          LIMIT 1
        `).bind(campaignId).first();

        if (!campaign) {
          return json({
            success: false,
            error: "Campaign not found or inactive"
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
            String(error.message || "").toLowerCase().includes("unique")
          ) {
            return json({
              success: true,
              duplicate: true
            });
          }
          throw error;
        }

        return json({
          success: true,
          message: "Event recorded"
        }, 201);
      }
    }

    // All remaining operations require business login.
    const user = await getUser(DB, request);

    if (user.error) {
      return json({
        success: false,
        error: user.error
      }, user.status);
    }

    // GET: CAMPAIGN LIST OR SINGLE CAMPAIGN
    if (method === "GET") {
      const campaignId = number(
        url.searchParams.get("campaign_id")
      );

      if (campaignId) {
        const campaign = await getOwnedCampaign(
          DB,
          campaignId,
          user
        );

        if (!campaign) {
          return json({
            success: false,
            error: "Campaign not found or access denied"
          }, 404);
        }

        const metrics = await getMetrics(DB, campaignId);

        return json({
          success: true,
          campaign: {
            ...campaign,
            metrics
          }
        });
      }

      const result = await DB.prepare(`
        SELECT *
        FROM campaigns
        WHERE user_id = ?
          AND business_id = ?
        ORDER BY created_at DESC, id DESC
      `).bind(user.userId, user.businessId).all();

      const campaigns = [];

      for (const campaign of result.results || []) {
        campaigns.push({
          ...campaign,
          metrics: await getMetrics(DB, Number(campaign.id))
        });
      }

      const totals = campaigns.reduce((sum, campaign) => {
        sum.views += campaign.metrics.views;
        sum.clicks += campaign.metrics.clicks;
        sum.enquiries += campaign.metrics.enquiries;
        sum.engagements += campaign.metrics.engagements;
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

    // CREATE CAMPAIGN
    if (method === "POST") {
      const body = await request.json();

      const campaignName = text(body.campaign_name, 120);
      const goal = text(body.goal, 80);
      const budget = number(body.budget, -1);
      const duration = number(body.duration, -1);
      const audience = text(body.audience, 500);
      const description = text(body.description, 3000);
      const status = text(body.status || "draft", 30).toLowerCase();

      if (!campaignName || !goal) {
        return json({
          success: false,
          error: "Campaign name and goal are required"
        }, 400);
      }

      if (
        budget < 0 ||
        budget > 100000000 ||
        duration < 1 ||
        duration > 365
      ) {
        return json({
          success: false,
          error: "Invalid budget or duration"
        }, 400);
      }

      if (!allowedStatuses.includes(status)) {
        return json({
          success: false,
          error: "Invalid campaign status"
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
        message: "Campaign created",
        campaign_id: result.meta?.last_row_id || null
      }, 201);
    }

    // UPDATE OR CHANGE STATUS
    if (method === "PATCH") {
      const body = await request.json();
      const campaignId = number(body.campaign_id);

      if (!Number.isInteger(campaignId) || campaignId < 1) {
        return json({
          success: false,
          error: "Valid campaign ID required"
        }, 400);
      }

      const existing = await getOwnedCampaign(
        DB,
        campaignId,
        user
      );

      if (!existing) {
        return json({
          success: false,
          error: "Campaign not found or access denied"
        }, 404);
      }

      const fields = [];
      const values = [];

      if (body.campaign_name !== undefined) {
        const value = text(body.campaign_name, 120);
        if (!value) {
          return json({
            success: false,
            error: "Campaign name cannot be empty"
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
            error: "Campaign goal cannot be empty"
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
            error: "Invalid budget"
          }, 400);
        }
        fields.push("budget = ?");
        values.push(value);
      }

      if (body.duration !== undefined) {
        const value = number(body.duration, -1);
        if (!Number.isInteger(value) || value < 1 || value > 365) {
          return json({
            success: false,
            error: "Duration must be between 1 and 365 days"
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
        const status = text(body.status, 30).toLowerCase();

        if (!allowedStatuses.includes(status)) {
          return json({
            success: false,
            error: "Invalid campaign status"
          }, 400);
        }

        fields.push("status = ?");
        values.push(status);
      }

      if (!fields.length) {
        return json({
          success: false,
          error: "No valid fields supplied"
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
        message: "Campaign updated"
      });
    }

    // DELETE CAMPAIGN
    if (method === "DELETE") {
      const campaignId = number(
        url.searchParams.get("campaign_id")
      );

      if (!Number.isInteger(campaignId) || campaignId < 1) {
        return json({
          success: false,
          error: "Valid campaign_id required"
        }, 400);
      }

      const existing = await getOwnedCampaign(
        DB,
        campaignId,
        user
      );

      if (!existing) {
        return json({
          success: false,
          error: "Campaign not found or access denied"
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
        message: "Campaign deleted"
      });
    }

    return json({
      success: false,
      error: "Method not allowed"
    }, 405);

  } catch (error) {
    return json({
      success: false,
      error: "Server error",
      detail: error?.message || "Unknown error"
    }, 500);
  }
}

export async function onRequest(context) {
  return handleRequest(context);
}
