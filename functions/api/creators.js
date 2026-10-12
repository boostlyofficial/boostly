
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

  try {
    if (request.method !== "GET") {
      return json({
        success: false,
        error: "Method not allowed"
      }, 405);
    }

    if (!env.DB) {
      return json({
        success: false,
        error: "Database is not configured"
      }, 500);
    }

    const result = await env.DB.prepare(`
      SELECT
        id,
        creator_name,
        creator_handle,
        category,
        bio,
        city,
        instagram_url,
        youtube_url,
        profile_image,
        status,
        created_at
      FROM creators
      WHERE LOWER(COALESCE(status, 'active')) = 'active'
      ORDER BY created_at DESC
      LIMIT 100
    `).all();

    return json({
      success: true,
      creators: result.results || [],
      count: (result.results || []).length
    });

  } catch (error) {
    return json({
      success: false,
      error: "Could not load creator profiles"
    }, 500);
  }
}
