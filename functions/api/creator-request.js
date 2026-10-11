
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

  if (request.method !== "POST") {
    return json({
      success: false,
      error: "Method not allowed. Use POST."
    }, 405);
  }

  try {
    const cookie = request.headers.get("Cookie") || "";
    const match = cookie.match(
      /(?:^|;\s*)boostly_session=([^;]+)/
    );

    if (!match) {
      return json({
        success: false,
        error: "Please log in before sending a collaboration request."
      }, 401);
    }

    // Confirm the session belongs to a real logged-in user.
    const session = await env.DB.prepare(
      "SELECT * FROM sessions WHERE id = ? LIMIT 1"
    ).bind(match[1]).first();

    if (!session) {
      return json({
        success: false,
        error: "Your session could not be verified. Please log in again."
      }, 401);
    }

    const body = await request.json();

    const creatorId = String(body.creator_id || "").trim();
    const brandName = String(body.brand_name || "").trim();
    const goal = String(body.goal || "").trim();
    const message = String(body.message || "").trim();
    const budget = body.budget === null ||
      body.budget === "" ||
      body.budget === undefined
        ? null
        : Number(body.budget);

    if (!creatorId || !brandName || !goal || !message) {
      return json({
        success: false,
        error: "Creator, business name, goal and message are required."
      }, 400);
    }

    if (
      brandName.length > 80 ||
      goal.length > 100 ||
      message.length > 300 ||
      (budget !== null &&
        (!Number.isFinite(budget) || budget < 0 || budget > 10000000))
    ) {
      return json({
        success: false,
        error: "Please check the field lengths and budget."
      }, 400);
    }

    // Only real creator records may receive requests.
    const creator = await env.DB.prepare(
      "SELECT id FROM creators WHERE id = ? LIMIT 1"
    ).bind(creatorId).first();

    if (!creator) {
      return json({
        success: false,
        error: "This creator is not registered in the database yet."
      }, 404);
    }

    // A verified session must identify a user.
    const userId = session.user_id;

    if (!userId) {
      return json({
        success: false,
        error: "The login session has no user ID."
      }, 401);
    }

    await env.DB.prepare(`
      INSERT INTO creator_requests
        (user_id, creator_id, brand_name, goal, budget, message, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
    `).bind(
      userId,
      creatorId,
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
      error: "Could not save the request. Database schema or configuration may need setup."
    }, 500);
  }
}
