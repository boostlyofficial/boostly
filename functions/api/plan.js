export async function onRequest(context) {
  try {
    const url = new URL(context.request.url);
    const businessId = url.searchParams.get("business_id");

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

    // Create FREE plan if no plan exists
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
          business_id,
          plan_code,
          status,
          started_at,
          expires_at,
          updated_at
        FROM boostly_business_plans
        WHERE business_id = ?
        LIMIT 1
      `)
      .bind(businessIdNumber)
      .first();

    let planCode = plan?.plan_code || "free";

    // If paid plan has expired, use FREE
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

    const featureSets = {
      free: [
        "basic_profile",
        "basic_posts",
        "basic_reels",
        "basic_editor",
        "basic_analytics"
      ],

      pro: [
        "basic_profile",
        "basic_posts",
        "basic_reels",
        "basic_editor",
        "basic_analytics",
        "advanced_editor",
        "premium_filters",
        "premium_effects",
        "advanced_analytics",
        "audience_insights",
        "promotion_campaigns",
        "creator_collaboration",
        "profile_boost",
        "verification_request",
        "premium_templates"
      ],

      business: [
        "basic_profile",
        "basic_posts",
        "basic_reels",
        "basic_editor",
        "basic_analytics",
        "advanced_editor",
        "premium_filters",
        "premium_effects",
        "advanced_analytics",
        "audience_insights",
        "promotion_campaigns",
        "creator_collaboration",
        "profile_boost",
        "verification_request",
        "premium_templates",
        "advanced_targeting",
        "creator_marketplace",
        "conversion_tracking",
        "multiple_campaigns",
        "advanced_reports",
        "priority_discovery"
      ],

      elite: [
        "basic_profile",
        "basic_posts",
        "basic_reels",
        "basic_editor",
        "basic_analytics",
        "advanced_editor",
        "premium_filters",
        "premium_effects",
        "advanced_analytics",
        "audience_insights",
        "promotion_campaigns",
        "creator_collaboration",
        "profile_boost",
        "verification_request",
        "premium_templates",
        "advanced_targeting",
        "creator_marketplace",
        "conversion_tracking",
        "multiple_campaigns",
        "advanced_reports",
        "priority_discovery",
        "premium_placement",
        "advanced_creator_campaigns",
        "advanced_conversion_analytics",
        "priority_support",
        "ai_growth_tools"
      ]
    };

    const features = featureSets[planCode] || featureSets.free;

    return new Response(
      JSON.stringify({
        success: true,
        business: {
          id: business.id,
          business_name: business.business_name
        },
        plan: {
          code: planCode,
          status: plan?.status || "active",
          started_at: plan?.started_at || null,
          expires_at: plan?.expires_at || null
        },
        features
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
