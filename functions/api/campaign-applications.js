
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

const text = (value, max = 1200) =>
  String(value ?? "").trim().slice(0, max);

const amount = value => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : NaN;
};

async function authenticate(DB, request) {
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

  const creator = await DB.prepare(`
    SELECT id, status FROM creators
    WHERE user_id = ?
    LIMIT 1
  `).bind(userId).first();

  return {
    userId,
    businessId: business ? Number(business.id) : 0,
    creatorId: creator ? Number(creator.id) : 0,
    creatorStatus: creator?.status || ""
  };
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
    const auth = await authenticate(DB, request);

    if (auth.error) {
      return json({
        success: false,
        error: auth.error
      }, auth.status);
    }

    const method = request.method.toUpperCase();
    const url = new URL(request.url);
    const campaignId = Number(
      url.searchParams.get("campaign_id") || 0
    );

    // CREATOR: Browse open campaigns and own applications.
    if (method === "GET" && !campaignId) {
      if (!auth.creatorId || auth.creatorStatus !== "active") {
        return json({
          success: false,
          error: "An active Boostly creator profile is required to browse and apply."
        }, 403);
      }

      const [campaignRows, applicationRows] = await Promise.all([
        DB.prepare(`
          SELECT
            c.id,
            c.business_id,
            c.campaign_name,
            c.goal,
            c.budget,
            c.duration,
            c.audience,
            c.description,
            c.status,
            c.created_at,
            b.business_name
          FROM campaigns c
          LEFT JOIN businesses b ON b.id = c.business_id
          WHERE c.status IN ('active','open','published')
            AND c.user_id != ?
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT 100
        `).bind(auth.userId).all(),

        DB.prepare(`
          SELECT
            id,
            campaign_id,
            application_message,
            proposed_amount,
            status,
            created_at,
            updated_at
          FROM campaign_applications
          WHERE creator_user_id = ?
          ORDER BY created_at DESC, id DESC
        `).bind(auth.userId).all()
      ]);

      return json({
        success: true,
        campaigns: campaignRows.results || [],
        applications: applicationRows.results || []
      });
    }

    // BUSINESS: List applications for a campaign it owns.
    if (method === "GET" && campaignId) {
      if (!auth.businessId) {
        return json({
          success: false,
          error: "Business profile not found."
        }, 403);
      }

      const campaign = await DB.prepare(`
        SELECT id FROM campaigns
        WHERE id = ?
          AND user_id = ?
          AND business_id = ?
        LIMIT 1
      `).bind(
        campaignId,
        auth.userId,
        auth.businessId
      ).first();

      if (!campaign) {
        return json({
          success: false,
          error: "Campaign not found or access denied."
        }, 404);
      }

      const result = await DB.prepare(`
        SELECT
          a.id,
          a.campaign_id,
          a.creator_user_id,
          a.application_message,
          a.proposed_amount,
          a.status,
          a.created_at,
          a.updated_at,
          cr.creator_name,
          cr.creator_handle,
          cr.category,
          cr.city,
          cr.profile_image
        FROM campaign_applications a
        LEFT JOIN creators cr
          ON cr.user_id = a.creator_user_id
        WHERE a.campaign_id = ?
        ORDER BY a.created_at DESC, a.id DESC
      `).bind(campaignId).all();

      return json({
        success: true,
        applications: result.results || []
      });
    }

    // CREATOR: Apply to a campaign.
    if (method === "POST") {
      if (!auth.creatorId || auth.creatorStatus !== "active") {
        return json({
          success: false,
          error: "An active Boostly creator profile is required to apply."
        }, 403);
      }

      const body = await request.json();

      const id = Number(body.campaign_id);
      const message = text(body.application_message, 1200);
      const proposedAmount = amount(body.proposed_amount);

      if (!Number.isInteger(id) || id < 1) {
        return json({
          success: false,
          error: "Valid campaign ID required."
        }, 400);
      }

      if (String(body.application_message ?? "").length > 1200) {
        return json({
          success: false,
          error: "Application message is too long."
        }, 400);
      }

      if (
        !Number.isFinite(proposedAmount) ||
        proposedAmount < 0 ||
        proposedAmount > 100000000
      ) {
        return json({
          success: false,
          error: "Invalid proposed amount."
        }, 400);
      }

      const campaign = await DB.prepare(`
        SELECT id, business_id, user_id, status
        FROM campaigns
        WHERE id = ?
        LIMIT 1
      `).bind(id).first();

      if (
        !campaign ||
        !["active", "open", "published"].includes(
          String(campaign.status).toLowerCase()
        )
      ) {
        return json({
          success: false,
          error: "This campaign is not accepting applications."
        }, 400);
      }

      if (Number(campaign.user_id) === auth.userId) {
        return json({
          success: false,
          error: "You cannot apply to your own campaign."
        }, 403);
      }

      try {
        const result = await DB.prepare(`
          INSERT INTO campaign_applications (
            campaign_id,
            business_id,
            creator_user_id,
            application_message,
            proposed_amount,
            status
          )
          VALUES (?, ?, ?, ?, ?, 'pending')
        `).bind(
          id,
          Number(campaign.business_id),
          auth.userId,
          message,
          proposedAmount
        ).run();

        return json({
          success: true,
          message: "Campaign application submitted.",
          application_id: Number(result.meta?.last_row_id || 0)
        }, 201);

      } catch (error) {
        if (
          String(error?.message || "")
            .toLowerCase()
            .includes("unique")
        ) {
          return json({
            success: false,
            error: "You have already applied to this campaign."
          }, 409);
        }

        throw error;
      }
    }

    // BUSINESS: Approve or reject an application.
    if (method === "PATCH") {
      if (!auth.businessId) {
        return json({
          success: false,
          error: "Business profile not found."
        }, 403);
      }

      const body = await request.json();

      const applicationId = Number(body.application_id);
      const status = text(body.status, 20).toLowerCase();

      if (!Number.isInteger(applicationId) || applicationId < 1) {
        return json({
          success: false,
          error: "Valid application ID required."
        }, 400);
      }

      if (!["approved", "rejected"].includes(status)) {
        return json({
          success: false,
          error: "Status must be approved or rejected."
        }, 400);
      }

      const application = await DB.prepare(`
        SELECT
          a.id,
          a.status AS application_status
        FROM campaign_applications a
        INNER JOIN campaigns c
          ON c.id = a.campaign_id
        WHERE a.id = ?
          AND c.user_id = ?
          AND c.business_id = ?
          AND a.business_id = ?
        LIMIT 1
      `).bind(
        applicationId,
        auth.userId,
        auth.businessId,
        auth.businessId
      ).first();

      if (!application) {
        return json({
          success: false,
          error: "Application not found or access denied."
        }, 404);
      }

      if (application.application_status !== "pending") {
        return json({
          success: false,
          error: "Only pending applications can be reviewed."
        }, 409);
      }

      await DB.prepare(`
        UPDATE campaign_applications
        SET
          status = ?,
          updated_at = datetime('now')
        WHERE id = ?
          AND status = 'pending'
      `).bind(status, applicationId).run();

      return json({
        success: true,
        message: "Application " + status + "."
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
