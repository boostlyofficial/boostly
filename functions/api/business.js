export async function onRequestPost(context) {
  try {

    // 1. Logged-in user's session cookie check karo
    const cookieHeader = context.request.headers.get("Cookie") || "";

    const match = cookieHeader.match(
      /(?:^|;\s*)boostly_session=([^;]+)/
    );

    if (!match) {
      return new Response("Please login first.", {
        status: 401
      });
    }

    const sessionId = match[1];


    // 2. Session se user ID nikalo
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
      return new Response("Your session has expired. Please login again.", {
        status: 401
      });
    }


    const userId = session.user_id;


    // 3. Form data read karo
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


    // 4. Required fields check
    if (!businessName || !category || !city) {
      return new Response(
        "Business Name, Category and City are required.",
        {
          status: 400
        }
      );
    }


    // 5. Check karo kya is user ka business already hai
    const existingBusiness = await context.env.DB
      .prepare(`
        SELECT id
        FROM businesses
        WHERE user_id = ?
        LIMIT 1
      `)
      .bind(userId)
      .first();


    // 6. Agar business already hai to update karo
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

      // 7. Agar business nahi hai to naya business create karo
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


    // 8. Business profile save hone ke baad dashboard par bhejo
    return Response.redirect(
      new URL("/dashboard.html?business=saved", context.request.url),
      303
    );

  } catch (error) {

    console.error("Business save error:", error);

    return new Response(
      "Business profile save failed.",
      {
        status: 500
      }
    );
  }
}
