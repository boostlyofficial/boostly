
export async function onRequest(context) {
  const { request, env } = context;

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });

  try {
    // 1. Verify existing Boostly login session
    const cookie = request.headers.get("Cookie") || "";
    const match = cookie.match(
      /(?:^|;\s*)boostly_session=([^;]+)/
    );

    if (!match) {
      return json({
        success: false,
        error: "Please log in before continuing."
      }, 401);
    }

    const session = await env.DB.prepare(`
      SELECT user_id
      FROM sessions
      WHERE id = ?
        AND expires_at > datetime('now')
      LIMIT 1
    `).bind(match[1]).first();

    if (!session || !session.user_id) {
      return json({
        success: false,
        error: "Session expired. Please log in again."
      }, 401);
    }

    // 2. Find this user's business
    const business = await env.DB.prepare(`
      SELECT id
      FROM businesses
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).bind(session.user_id).first();

    if (!business) {
      return json({
        success: false,
        error: "Create a business profile first."
      }, 400);
    }

    const businessId = business.id;
    const method = request.method;

    // 3. GET: Load campaigns belonging to this business
    if (method === "GET") {
      const result = await env.DB.prepare(`
        SELECT
          id,
          campaign_name,
          goal,
          budget,
          duration,
          audience,
          description,
          status,
          created_at,
          updated_at
        FROM campaigns
        WHERE user_id = ?
          AND business_id = ?
        ORDER BY id DESC
      `).bind(session.user_id, businessId).all();

      return json({
        success: true,
        campaigns: result.results || []
      });
    }

    // Only POST, PUT and DELETE are supported below
    if (!["POST", "PUT", "DELETE"].includes(method)) {
      return json({
        success: false,
        error: "Method not allowed."
      }, 405);
    }

    // 4. Read request body
    let body;

    try {
      body = await request.json();
    } catch {
      return json({
        success: false,
        error: "Invalid JSON request."
      }, 400);
    }

    // 5. DELETE: Delete only this user's campaign
    if (method === "DELETE") {
      const id = Number(body.id);

      if (!Number.isInteger(id) || id < 1) {
        return json({
          success: false,
          error: "Invalid campaign ID."
        }, 400);
      }

      const result = await env.DB.prepare(`
        DELETE FROM campaigns
        WHERE id = ?
          AND user_id = ?
          AND business_id = ?
      `).bind(id, session.user_id, businessId).run();

      if (!result.meta || result.meta.changes !== 1) {
        return json({
          success: false,
          error: "Campaign not found."
        }, 404);
      }

      return json({
        success: true,
        message: "Campaign deleted successfully."
      });
    }

    // 6. Validate campaign details
    const campaignName = String(body.campaign_name || "").trim();
    const goal = String(body.goal || "").trim();
    const audience = String(body.audience || "").trim();
    const description = String(body.description || "").trim();

    const budget = Number(body.budget);
    const duration = Number(body.duration);

    if (!campaignName || !goal) {
      return json({
        success: false,
        error: "Campaign name and goal are required."
      }, 400);
    }

    if (
      campaignName.length > 100 ||
      goal.length > 100 ||
      audience.length > 200 ||
      description.length > 2000 ||
      !Number.isFinite(budget) ||
      budget < 0 ||
      budget > 100000000 ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 365
    ) {
      return json({
        success: false,
        error: "Please check your campaign details."
      }, 400);
    }

    // 7. POST: Create a new draft campaign
    if (method === "POST") {
      const result = await env.DB.prepare(`
        INSERT INTO campaigns (
          user_id,
          business_id,
          campaign_name,
          goal,
          budget,
          duration,
          audience,
          description,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft',
                datetime('now'), datetime('now'))
      `).bind(
        session.user_id,
        businessId,
        campaignName,
        goal,
        budget,
        duration,
        audience,
        description
      ).run();

      return json({
        success: true,
        message: "Campaign saved successfully.",
        campaign_id: result.meta?.last_row_id || null
      }, 201);
    }

    // 8. PUT: Update an existing campaign
    if (method === "PUT") {
      const id = Number(body.id);

      if (!Number.isInteger(id) || id < 1) {
        return json({
          success: false,
          error: "Invalid campaign ID."
        }, 400);
      }

      const result = await env.DB.prepare(`
        UPDATE campaigns
        SET
          campaign_name = ?,
          goal = ?,
          budget = ?,
          duration = ?,
          audience = ?,
          description = ?,
          updated_at = datetime('now')
        WHERE id = ?
          AND user_id = ?
          AND business_id = ?
      `).bind(
        campaignName,
        goal,
        budget,
        duration,
        audience,
        description,
        id,
        session.user_id,
        businessId
      ).run();

      if (!result.meta || result.meta.changes !== 1) {
        return json({
          success: false,
          error: "Campaign not found or no changes were made."
        }, 404);
      }

      return json({
        success: true,
        message: "Campaign updated successfully.",
        campaign_id: id
      });
    }

  } catch (error) {
    return json({
      success: false,
      error: "Could not process campaign request. Please try again."
    }, 500);
  }
}
