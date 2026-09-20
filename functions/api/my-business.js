export async function onRequestGet(context) {
  try {

    const cookieHeader =
      context.request.headers.get("Cookie") || "";

    const match = cookieHeader.match(
      /(?:^|;\s*)boostly_session=([^;]+)/
    );

    if (!match) {
      return new Response(
        JSON.stringify({
          error: "Not logged in"
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const sessionId = match[1];

    const session = await context.env.DB
      .prepare(`
        SELECT user_id
        FROM sessions
        WHERE id = ?
        AND expires_at > datetime('now')
      `)
      .bind(sessionId)
      .first();

    if (!session) {
      return new Response(
        JSON.stringify({
          error: "Session expired"
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const business = await context.env.DB
      .prepare(`
        SELECT
          id,
          business_name,
          category,
          phone,
          whatsapp,
          city,
          address,
          description,
          image_url,
          created_at
        FROM businesses
        WHERE user_id = ?
        LIMIT 1
      `)
      .bind(session.user_id)
      .first();

    if (!business) {
      return new Response(
        JSON.stringify({
          error: "Business profile not found"
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    return new Response(
      JSON.stringify(business),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  } catch (error) {

    return new Response(
      JSON.stringify({
        error: "Server error"
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
}
