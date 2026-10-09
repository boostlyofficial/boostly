export async function onRequestGet(context) {
  try {
    const DB = context.env.DB;

    // Check login session
    const cookieHeader =
      context.request.headers.get("Cookie") || "";

    const match = cookieHeader.match(
      /(?:^|;\s*)boostly_session=([^;]+)/
    );

    if (!match) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Please login first"
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const sessionId = decodeURIComponent(match[1]);

    // Find logged-in user
    const session = await DB.prepare(`
      SELECT user_id
      FROM sessions
      WHERE session_id = ?
      LIMIT 1
    `)
      .bind(sessionId)
      .first();

    if (!session) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid session. Please login again."
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const userId = session.user_id;

    // Load posts saved by the logged-in user
    const result = await DB.prepare(`
      SELECT
        p.id,
        p.business_id,
        p.post_type,
        p.media_type,
        p.media_url,
        p.thumbnail_url,
        p.caption,
        p.location,
        p.hashtags,
        p.likes_count,
        p.comments_count,
        p.shares_count,
        p.views_count,
        p.created_at,
        b.business_name,
        b.category,
        b.city,
        s.created_at AS saved_at
      FROM boost_post_saves s
      INNER JOIN boost_posts p
        ON p.id = s.post_id
      LEFT JOIN businesses b
        ON b.id = p.business_id
      WHERE s.user_id = ?
        AND p.status = 'published'
      ORDER BY s.created_at DESC
      LIMIT 100
    `)
      .bind(userId)
      .all();

    const posts = result.results || [];

    return new Response(
      JSON.stringify({
        success: true,
        count: posts.length,
        posts: posts
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
    return new Response(
      JSON.stringify({
        success: false,
        error: "Could not load saved posts",
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
