export async function onRequestPost(context) {

  try {

    const cookieHeader =
      context.request.headers.get("Cookie") || "";

    const match = cookieHeader.match(
      /(?:^|;\s*)boostly_session=([^;]+)/
    );

    if (!match) {
      return new Response(
        JSON.stringify({
          success: false,
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
          success: false,
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

    const formData =
      await context.request.formData();

    const businessId =
      formData.get("business_id");

    const mediaType =
      formData.get("media_type");

    const mediaUrl =
      formData.get("media_url");

    const publicId =
      formData.get("public_id") || "";

    if (!businessId || !mediaType || !mediaUrl) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing media information"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const business =
      await context.env.DB
        .prepare(`
          SELECT id
          FROM businesses
          WHERE id = ?
          AND user_id = ?
          LIMIT 1
        `)
        .bind(
          businessId,
          session.user_id
        )
        .first();

    if (!business) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Business not found"
        }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    await context.env.DB
      .prepare(`
        INSERT INTO business_media
        (
          business_id,
          media_type,
          media_url,
          public_id,
          created_at
        )
        VALUES (?, ?, ?, ?, datetime('now'))
      `)
      .bind(
        businessId,
        mediaType,
        mediaUrl,
        publicId
      )
      .run();

    return new Response(
      JSON.stringify({
        success: true,
        message: "Media saved successfully"
      }),
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
        success: false,
        error: "Server error",
        details: error.message
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
