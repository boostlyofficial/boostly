export async function onRequest(context) {
  try {
    const url = new URL(context.request.url);

    const businessId = url.searchParams.get("business_id");
    const feature = url.searchParams.get("feature");

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

    const businessIdNumber = Number(businessId);

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

    // Check business
    const business = await context.env.DB
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

    // Feature requirements
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
      verification_request: "pro",
      premium_templates: "pro",

      advanced_targeting: "business",
      creator_marketplace: "business",
      conversion_tracking: "business",
      multiple_campaigns: "business",
      advanced_reports: "business",
      priority_discovery: "business",

      premium_placement: "elite",
      advanced_creator_campaigns: "elite",
      advanced_conversion_analytics: "elite",
      priority_support: "elite",
      ai_growth_tools: "elite"
    };

    const minimumPlan = featurePlans[feature];

    if (!minimumPlan) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Unknown feature",
          feature: feature
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Create FREE plan if missing
    await context.env.DB
      .prepare(`
        INSERT OR IGNORE INTO boostly_business_plans
        (business_id, plan_code, status)
        VALUES (?, 'free', 'active')
      `)
      .bind(businessIdNumber)
      .run();

    // Get current plan
    const plan = await context.env.DB
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

    let currentPlan = plan?.plan_code || "free";

    // Expired paid plan becomes FREE
    if (
      plan &&
      plan.expires_at &&
      new Date(plan.expires_at) < new Date()
    ) {
      currentPlan = "free";

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

    // Plan levels
    const planLevel = {
      free: 0,
      pro: 1,
      business: 2,
      elite: 3
    };

    const currentLevel = planLevel[currentPlan] ?? 0;
    const requiredLevel = planLevel[minimumPlan] ?? 0;

    const allowed = currentLevel >= requiredLevel;

    return new Response(
      JSON.stringify({
        success: true,
        business_id: businessIdNumber,
        business_name: business.business_name,
        feature: feature,
        plan: currentPlan,
        allowed: allowed,
        upgrade_required: !allowed,
        minimum_plan: minimumPlan
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Server error"
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
