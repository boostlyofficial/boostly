
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });

export async function onRequest(context) {
  const { request, env } = context;
  const DB = env.DB;

  try {
    const cookie = request.headers.get("Cookie") || "";
    const match = cookie.match(/(?:^|;\s*)boostly_session=([^;]+)/);

    if (!match) {
      return json({ success: false, error: "Not logged in" }, 401);
    }

    const session = await DB.prepare(`
      SELECT user_id FROM sessions
      WHERE id = ? AND expires_at > datetime('now')
      LIMIT 1
    `).bind(match[1]).first();

    if (!session) {
      return json({ success: false, error: "Session expired. Please login again." }, 401);
    }

    const userId = Number(session.user_id);
    const method = request.method;
    const url = new URL(request.url);
    const campaignId = Number(url.searchParams.get("campaign_id") || 0);

    const business = await DB.prepare(`
      SELECT id FROM businesses
      WHERE user_id = ?
      ORDER BY id DESC LIMIT 1
    `).bind(userId).first();

    const businessId = business ? Number(business.id) : 0;

    // CREATOR: Browse campaigns open for applications
    if (method === "GET" && !campaignId) {
      const campaigns = await DB.prepare(`
        SELECT
          id, business_id, campaign_name, goal, budget,
          duration, audience, description, status, created_at
        FROM campaigns
        WHERE status IN ('open', 'active', 'published')
          AND user_id != ?
        ORDER BY created_at DESC
        LIMIT 100
      `).bind(userId).all();

      const applications = await DB.prepare(`
        SELECT
          id, campaign_id, application_message,
          proposed_amount, status, created_at, updated_at
        FROM campaign_applications
        WHERE creator_user_id = ?
        ORDER BY created_at DESC
      `).bind(userId).all();

      return json({
        success: true,
        campaigns: campaigns.results || [],
        applications: applications.results || []
      });
    }

    // BUSINESS: View applications for its own campaign
    if (method === "GET" && campaignId) {
      if (!businessId) {
        return json({ success: false, error: "Business profile not found" }, 403);
      }

      const campaign = await DB.prepare(`
        SELECT id FROM campaigns
        WHERE id = ? AND user_id = ? AND business_id = ?
        LIMIT 1
      `).bind(campaignId, userId, businessId).first();

      if (!campaign) {
        return json({ success: false, error: "Campaign not found or access denied" }, 404);
      }

      const applications = await DB.prepare(`
        SELECT
          id, campaign_id, creator_user_id,
          application_message, proposed_amount,
          status, created_at, updated_at
        FROM campaign_applications
        WHERE campaign_id = ?
        ORDER BY created_at DESC
      `).bind(campaignId).all();

      return json({
        success: true,
        applications: applications.results || []
      });
    }

    // CREATOR: Apply to a campaign
    if (method === "POST") {
      const body = await request.json();

      const id = Number(body.campaign_id);
      const message = String(body.application_message || "").trim();
      const amount = Number(body.proposed_amount || 0);

      if (!Number.isInteger(id) || id < 1) {
        return json({ success: false, error: "Valid campaign ID required" }, 400);
      }

      if (message.length > 1200) {
        return json({ success: false, error: "Message is too long" }, 400);
      }

      if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) {
        return json({ success: false, error: "Invalid proposed amount" }, 400);
      }

      const campaign = await DB.prepare(`
        SELECT id, business_id, user_id, status
        FROM campaigns
        WHERE id = ?
        LIMIT 1
      `).bind(id).first();

      if (!campaign ||
          !["open", "active", "published"].includes(campaign.status)) {
        return json({ success: false, error: "This campaign is not accepting applications" }, 400);
      }

      if (Number(campaign.user_id) === userId) {
        return json({ success: false, error: "You cannot apply to your own campaign" }, 403);
      }

      try {
        const result = await DB.prepare(`
          INSERT INTO campaign_applications (
            campaign_id, business_id, creator_user_id,
            application_message, proposed_amount, status
          ) VALUES (?, ?, ?, ?, ?, 'pending')
        `).bind(
          id,
          Number(campaign.business_id),
          userId,
          message,
          amount
        ).run();

        return json({
          success: true,
          message: "Campaign application submitted",
          application_id: result.meta?.last_row_id || null
        }, 201);

      } catch (error) {
        if (String(error.message || "").toLowerCase().includes("unique")) {
          return json({
            success: false,
            error: "You have already applied to this campaign"
          }, 409);
        }
        throw error;
      }
    }

    // BUSINESS: Approve or reject an application
    if (method === "PATCH") {
      if (!businessId) {
        return json({ success: false, error: "Business profile not found" }, 403);
      }

      const body = await request.json();
      const applicationId = Number(body.application_id);
      const status = String(body.status || "").toLowerCase();

      if (!Number.isInteger(applicationId) || applicationId < 1) {
        return json({ success: false, error: "Valid application ID required" }, 400);
      }

      if (!["approved", "rejected"].includes(status)) {
        return json({ success: false, error: "Status must be approved or rejected" }, 400);
      }

      const application = await DB.prepare(`
        SELECT a.id
        FROM campaign_applications a
        INNER JOIN campaigns c ON c.id = a.campaign_id
        WHERE a.id = ?
          AND c.user_id = ?
          AND c.business_id = ?
          AND a.business_id = ?
        LIMIT 1
      `).bind(applicationId, userId, businessId, businessId).first();

      if (!application) {
        return json({ success: false, error: "Application not found or access denied" }, 404);
      }

      await DB.prepare(`
        UPDATE campaign_applications
        SET status = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(status, applicationId).run();

      return json({
        success: true,
        message: "Application " + status
      });
    }

    return json({ success: false, error: "Method not allowed" }, 405);

  } catch (error) {
    return json({
      success: false,
      error: "Server error",
      detail: error.message || "Unknown error"
    }, 500);
  }
}
