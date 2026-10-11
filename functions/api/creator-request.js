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

    // GET: Load the logged-in user's requests
    if (request.method === "GET") {
      const result = await env.DB.prepare(`
        SELECT
          id,
          creator_name,
          creator_handle,
          brand_name,
          goal,
          budget,
          message,
          status,
          created_at
        FROM creator_requests
        WHERE user_id = ?
        ORDER BY id DESC
      `).bind(session.user_id).all();

      return json({
        success: true,
        requests: result.results || []
      });
    }

    // POST: Create a request or cancel a pending request
    if (request.method !== "POST") {
      return json({
        success: false,
        error: "Method not allowed."
      }, 405);
    }

    const body = await request.json();

    // CANCEL an existing pending request
    if (body.action === "cancel") {
      const requestId = Number(body.request_id);

      if (!Number.isInteger(requestId) || requestId < 1) {
        return json({
          success: false,
          error: "Invalid request ID."
        }, 400);
      }

      const result = await env.DB.prepare(`
        UPDATE creator_requests
        SET status = 'cancelled'
        WHERE id = ?
          AND user_id = ?
          AND status = 'pending'
      `).bind(requestId, session.user_id).run();

      if (!result.meta || result.meta.changes !== 1) {
        return json({
          success: false,
          error: "Request not found or it is no longer pending."
        }, 400);
      }

      return json({
        success: true,
        message: "Request cancelled successfully.",
        request_id: requestId,
        status: "cancelled"
      });
    }

    // CREATE a new collaboration request
    const creatorName = String(body.creator_name || "").trim();
    const creatorHandle = String(body.creator_handle || "").trim();
    const brandName = String(body.brand_name || "").trim();
    const goal = String(body.goal || "").trim();
    const message = String(body.message || "").trim();

    const budget =
      body.budget === null ||
      body.budget === "" ||
      body.budget === undefined
        ? 0
        : Number(body.budget);

    if (!creatorName || !brandName || !goal || !message) {
      return json({
        success: false,
        error: "Creator, business name, goal and message are required."
      }, 400);
    }

    if (
      creatorName.length > 100 ||
      creatorHandle.length > 100 ||
      brandName.length > 80 ||
      goal.length > 100 ||
      message.length > 300 ||
      !Number.isFinite(budget) ||
      budget < 0 ||
      budget > 10000000
    ) {
      return json({
        success: false,
        error: "Please check the entered details and budget."
      }, 400);
    }

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
        error: "Create a business profile before sending a request."
      }, 400);
    }

    await env.DB.prepare(`
      INSERT INTO creator_requests
        (user_id, business_id, creator_name, creator_handle,
         brand_name, goal, budget, message, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
    `).bind(
      session.user_id,
      business.id,
      creatorName,
      creatorHandle,
      brandName,
      goal,
      budget,
      message
    ).run();

    return json({
      success: true,
      message: "Collaboration request saved successfully.",
      status: "pending"
    }, 201);

  } catch (error) {
    return json({
      success: false,
      error: "Could not process the request. Please try again."
    }, 500);
  }
}
