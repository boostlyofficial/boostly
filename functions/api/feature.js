export async function onRequest(context) {

  try {

    const url = new URL(context.request.url);

    const businessId =
      url.searchParams.get("business_id");

    const feature =
      url.searchParams.get("feature");


    // ==========================================
    // VALIDATION
    // ==========================================

    if (!businessId || !feature) {

      return new Response(
        JSON.stringify({
          success: false,
          error: "business_id and feature are required"
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


    // ==========================================
    // CHECK BUSINESS
    // ==========================================

    const business =
      await context.env.DB
        .prepare(`
          SELECT id, business_name
          FROM businesses
          WHERE id = ?
          LIMIT 1
        `)
        .bind(businessIdNumber)
        .first();


    if (!business) {

      return new Response(
        JSON.stringify({
          success: false,
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


    // ==========================================
    // FEATURE → MINIMUM PLAN
    // ==========================================

    const featurePlans = {

      basic_profile: "free",
      basic_posts: "free",
      basic_reels: "free",
      basic_editor: "free",
      basic_analytics: "free",

      advanced_editor: "pro",
      premium_filters: "pro",
      premium_effects: "pro",
      advanced_analytics: "pro",
      audience_insights: "pro",
      promotion_campaigns: "pro",
      creator_collaboration: "pro",
      profile_boost: "pro",
      verification_request: "
