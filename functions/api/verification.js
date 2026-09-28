export async function onRequest(context) {

  try {

    const url = new URL(context.request.url);

    const businessId =
      url.searchParams.get("business_id");


    // =====================================================
    // GET = LOAD VERIFICATION STATUS
    // =====================================================

    if (context.request.method === "GET") {

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


      const verification =
        await context.env.DB
          .prepare(`
            SELECT
              id,
              business_id,
              status,
              business_name,
              submitted_at,
              reviewed_at,
              review_note,
              updated_at
            FROM boostly_verifications
            WHERE business_id = ?
            LIMIT 1
          `)
          .bind(businessIdNumber)
          .first();


      if (!verification) {

        return new Response(
          JSON.stringify({
            success: true,
            business_id: businessIdNumber,
            status: "not_requested"
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


      return new Response(
        JSON.stringify({
          success: true,
          verification
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
    // ONLY POST AFTER GET
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
    // LOGIN SESSION CHECK
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


    const sessionId =
      match[1];


    // =====================================================
    // CHECK SESSION
    // =====================================================

    const session =
      await context.env.DB
        .prepare(`
          SELECT user_id
          FROM sessions
          WHERE id = ?
          AND expires_at > datetime('now')
          LIMIT 1
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
    // BUSINESS ID CHECK
    // =====================================================

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


    // =====================================================
    // CHECK BUSINESS OWNERSHIP
    // =====================================================

    const business =
      await context.env.DB
        .prepare(`
          SELECT
            id,
            business_name
          FROM businesses
          WHERE id = ?
          AND user_id = ?
          LIMIT 1
        `)
        .bind(
          businessIdNumber,
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
    // CHECK CURRENT PLAN
    // =====================================================

    await context.env.DB
      .prepare(`
        INSERT OR IGNORE INTO boostly_business_plans
        (business_id, plan_code, status)
        VALUES (?, 'free', 'active')
      `)
      .bind(businessIdNumber)
      .run();


    const plan =
      await context.env.DB
        .prepare(`
          SELECT
            plan_code,
            status,
            expires_at
          FROM boostly_business_plans
          WHERE business_id = ?
          LIMIT 1
        `)
        .bind(businessIdNumber)
        .first();


    let planCode =
      plan?.plan_code || "free";


    // =====================================================
    // EXPIRED PLAN = FREE
    // =====================================================

    if (
      plan &&
      plan.expires_at &&
      new Date(plan.expires_at) < new Date()
    ) {

      planCode = "free";

      await context.env.DB
        .prepare(`
          UPDATE boostly_business_plans
          SET
            plan_code = 'free',
            status = 'active',
            updated_at = datetime('now')
          WHERE business_id = ?
        `)
        .bind(businessIdNumber)
        .run();

    }


    // =====================================================
    // VERIFICATION REQUIRES PAID PLAN
    // =====================================================

    if (
      planCode !== "pro" &&
      planCode !== "business" &&
      planCode !== "elite"
    ) {

      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Verification request requires a Pro, Business or Elite plan",
          plan: planCode,
          upgrade_required: true
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
    // CHECK EXISTING VERIFICATION
    // =====================================================

    const existing =
      await context.env.DB
        .prepare(`
          SELECT
            id,
            status
          FROM boostly_verifications
          WHERE business_id = ?
          LIMIT 1
        `)
        .bind(businessIdNumber)
        .first();


    if (
      existing &&
      existing.status === "verified"
    ) {

      return new Response(
        JSON.stringify({
          success: false,
          error: "Business is already verified",
          status: "verified"
        }),
        {
          status: 409,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

    }


    if (
      existing &&
      existing.status === "pending"
    ) {

      return new Response(
        JSON.stringify({
          success: false,
          error: "Verification request is already pending",
          status: "pending"
        }),
        {
          status: 409,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

    }


    // =====================================================
    // CREATE / UPDATE VERIFICATION REQUEST
    // =====================================================

    await context.env.DB
      .prepare(`
        INSERT INTO boostly_verifications
        (
          business_id,
          status,
          business_name,
          submitted_at,
          updated_at
        )
        VALUES (
          ?,
          'pending',
          ?,
          datetime('now'),
          datetime('now')
        )
        ON CONFLICT(business_id)
        DO UPDATE SET
          status = 'pending',
          business_name = excluded.business_name,
          submitted_at = datetime('now'),
          reviewed_at = NULL,
          review_note = NULL,
          updated_at = datetime('now')
      `)
      .bind(
        businessIdNumber,
        business.business_name
      )
      .run();


    // =====================================================
    // SUCCESS
    // =====================================================

    return new Response(
      JSON.stringify({
        success: true,
        message:
          "Verification request submitted successfully",
        business_id:
          businessIdNumber,
        status:
          "pending"
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
