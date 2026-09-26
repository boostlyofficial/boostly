export async function onRequest(context) {

  try {

    // =====================================================
    // GET = LOAD MEDIA FOR BUSINESS PROFILE
    // =====================================================

    if (context.request.method === "GET") {

      const url = new URL(context.request.url);

      const businessId =
        url.searchParams.get("business_id");

      if (!businessId) {

        return new Response(
          JSON.stringify({
            success: false,
            error: "business_id is required"
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );

      }

      // Make sure business ID is a valid number
      const businessIdNumber =
        Number(businessId);

      if (
        !Number.isInteger(businessIdNumber) ||
        businessIdNumber <= 0
      ) {

        return new Response(
          JSON.stringify({
            success: false,
            error: "Invalid business_id"
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );

      }

      // ---------------------------------------------
      // LOAD MEDIA FROM D1
      // ---------------------------------------------

      const media =
        await context.env.DB
          .prepare(`
            SELECT
              id,
              business_id,
              media_type,
              media_url,
              public_id,
              caption,
              likes_count,
              views_count,
              created_at
            FROM business_media
            WHERE business_id = ?
            ORDER BY created_at DESC
          `)
          .bind(businessIdNumber)
          .all();

      return new Response(
        JSON.stringify({
          success: true,
          media: media.results || []
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        }
      );

    }


    // =====================================================
    // POST = SAVE MEDIA
    // =====================================================

    if (context.request.method !== "POST") {

      return new Response(
        JSON.stringify({
          success: false,
          error: "Only GET and POST methods are allowed"
        }),
        {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            "Allow": "GET, POST"
          }
        }
      );

    }


    // =====================================================
    // CHECK LOGIN SESSION
    // =====================================================

    const cookieHeader =
      context.request.headers.get("Cookie") || "";

    const match =
      cookieHeader.match(
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


    // =====================================================
    // CHECK SESSION IN D1
    // =====================================================

    const session =
      await context.env.DB
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


    // =====================================================
    // READ FORM DATA
    // =====================================================

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

    const caption =
      formData.get("caption") || "";


    // =====================================================
    // VALIDATION
    // =====================================================

    if (
      !businessId ||
      !mediaType ||
      !mediaUrl
    ) {

      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Business ID, media type or media URL missing"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

    }


    // =====================================================
    // CHECK BUSINESS OWNERSHIP
    // =====================================================

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
          error: "Business profile not found"
        }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

    }


    // =====================================================
    // SAVE MEDIA
    // =====================================================

    await context.env.DB
      .prepare(`
        INSERT INTO business_media
        (
          business_id,
          media_type,
          media_url,
          public_id,
          caption,
          likes_count,
          views_count,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, 0, 0, datetime('now'))
      `)
      .bind(
        businessId,
        mediaType,
        mediaUrl,
        publicId,
        caption
      )
      .run();


    // =====================================================
    // SUCCESS
    // =====================================================

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

    console.error(error);

    return new Response(
      JSON.stringify({
        success: false,
        error:
          error.message ||
          "Server error"
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
