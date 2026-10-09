export async function onRequestPost(context) {
  const headers = {
    "Content-Type": "application/json"
  };

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers
    });

  try {
    const cookieHeader =
      context.request.headers.get("Cookie") || "";

    const match = cookieHeader.match(
      /(?:^|;\s*)boostly_session=([^;]+)/
    );

    if (!match) {
      return json({
        success: false,
        error: "Please login first."
      }, 401);
    }

    const sessionId = match[1];

    const session = await context.env.DB
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
      return json({
        success: false,
        error: "Session expired. Please login again."
      }, 401);
    }

    const formData =
      await context.request.formData();

    const postId = Number(formData.get("post_id"));
    const action = String(
      formData.get("action") || "save"
    ).toLowerCase();

    if (!Number.isSafeInteger(postId) || postId <= 0) {
      return json({
        success: false,
        error: "Valid post ID is required."
      }, 400);
    }

    if (action !== "save" && action !== "unsave") {
      return json({
        success: false,
        error: "Invalid save action."
      }, 400);
    }

    const post = await context.env.DB
      .prepare(`
        SELECT id
        FROM boost_posts
        WHERE id = ?
        LIMIT 1
      `)
      .bind(postId)
      .first();

    if (!post) {
      return json({
        success: false,
        error: "Post not found."
      }, 404);
    }

    const existing = await context.env.DB
      .prepare(`
        SELECT id
        FROM boost_post_saves
        WHERE post_id = ?
          AND user_id = ?
        LIMIT 1
      `)
      .bind(postId, session.user_id)
      .first();

    if (action === "unsave") {
      if (existing) {
        await context.env.DB
          .prepare(`
            DELETE FROM boost_post_saves
            WHERE post_id = ?
              AND user_id = ?
          `)
          .bind(postId, session.user_id)
          .run();
      }

      const countResult = await context.env.DB
        .prepare(`
          SELECT COUNT(*) AS total
          FROM boost_post_saves
          WHERE post_id = ?
        `)
        .bind(postId)
        .first();

      return json({
        success: true,
        saved: false,
        saves_count: Number(countResult?.total || 0),
        message: "Post removed from saved posts."
      });
    }

    if (!existing) {
      await context.env.DB
        .prepare(`
          INSERT INTO boost_post_saves
            (post_id, user_id, created_at)
          VALUES (?, ?, datetime('now'))
        `)
        .bind(postId, session.user_id)
        .run();
    }

    const countResult = await context.env.DB
      .prepare(`
        SELECT COUNT(*) AS total
        FROM boost_post_saves
        WHERE post_id = ?
      `)
      .bind(postId)
      .first();

    return json({
      success: true,
      saved: true,
      saves_count: Number(countResult?.total || 0),
      message: existing
        ? "Post is already saved."
        : "Post saved successfully."
    });

  } catch (error) {
    console.error("Boost post save error:", error);

    return json({
      success: false,
      error: "Unable to save post. Please try again."
    }, 500);
  }
}
