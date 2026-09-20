export async function onRequestPost(context) {
  try {

    if (!context.env.DB) {
      return new Response("ERROR: D1 database binding DB not found.", {
        status: 500
      });
    }

    const cookieHeader = context.request.headers.get("Cookie") || "";

    const match = cookieHeader.match(
      /(?:^|;\s*)boostly_session=([^;]+)/
    );

    if (!match) {
      return new Response(
        "ERROR: You are not logged in. Please login again.",
        { status: 401 }
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
        "ERROR: Session expired. Please login again.",
        { status: 401 }
      );
    }

    const userId = session.user_id;

    const formData = await context.request.formData();

    const businessName = String(
      formData.get("businessName") || ""
    ).trim();

    const category = String(
      formData.get("category") || ""
    ).trim();

    const phone = String(
      formData.get("phone") || ""
    ).trim();

    const whatsapp = String(
      formData.get("whatsapp") || ""
    ).trim();

    const city = String(
      formData.get("city") || ""
    ).trim();

    const address = String(
      formData.get("address") || ""
    ).trim();

    const description = String(
      formData.get("description") || ""
    ).trim();

    if (!businessName || !category || !city) {
      return new Response(
        "ERROR: Business Name, Category and City are required.",
        { status: 400 }
      );
    }

    const existingBusiness = await context.env.DB
      .prepare(`
        SELECT id
        FROM businesses
        WHERE user_id = ?
        LIMIT 1
      `)
      .bind(userId)
      .first();

    if (existingBusiness) {

      await context.env.DB
        .prepare(`
          UPDATE businesses
          SET
            business_name = ?,
            category = ?,
            phone = ?,
            whatsapp = ?,
            city = ?,
            address = ?,
            description = ?
          WHERE id = ?
          AND user_id = ?
        `)
        .bind(
          businessName,
          category,
          phone || null,
          whatsapp || null,
          city,
          address || null,
          description || null,
          existingBusiness.id,
          userId
        )
        .run();

    } else {

      await context.env.DB
        .prepare(`
          INSERT INTO businesses
          (
            user_id,
            business_name,
            category,
            phone,
            whatsapp,
            city,
            address,
            description
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          userId,
          businessName,
          category,
          phone || null,
          whatsapp || null,
          city,
          address || null,
          description || null
        )
        .run();
    }

    return Response.redirect(
      new URL(
        "/dashboard.html?business=saved",
        context.request.url
      ),
      303
    );

  } catch (error) {

    return new Response(
      "BUSINESS PROFILE ERROR: " + error.message,
      {
        status: 500,
        headers: {
          "Content-Type": "text/plain"
        }
      }
    );
  }
}
