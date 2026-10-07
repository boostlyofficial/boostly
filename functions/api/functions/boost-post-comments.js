export async function onRequest(context) {
  try {
    const DB = context.env.DB;

    if (!DB) {
      return json({
        success: false,
        error: "Database binding not found"
      }, 500);
    }

    const request = context.request;
    const method = request.method.toUpperCase();

    // =====================================================
    // GET = LOAD COMMENTS
    // =====================================================

    if (method === "GET") {
      const url = new URL(request.url);

      const postId = Number(
        url.searchParams.get("post_id")
      );

      if (!postId) {
        return json({
          success: false,
          error: "post_id is required"
        }, 400);
      }

      const result = await DB.prepare(`
        SELECT
          c.id,
          c.post_id,
          c.user_id,
          c.comment_text,
          c.created_at,
          u.full_name
        FROM boost_post_comments c
        LEFT JOIN users u
          ON u.id = c.user_id
        WHERE c.post_id = ?
        ORDER BY c.id DESC
      `)
      .bind(postId)
      .all();

      return json({
        success: true,
        comments: result.results || []
      });
    }


    // =====================================================
    // POST = CREATE COMMENT
    // =====================================================

    if (method === "POST") {

      // ---------------------------------------------------
      // CHECK LOGIN SESSION
      // ---------------------------------------------------

      const cookieHeader =
        request.headers.get("Cookie") || "";

      const match =
        cookieHeader.match(
          /(?:^|;\s*)boostly_session=([^;]+)/
        );

      const sessionId =
        match ? decodeURIComponent(match[1]) : "";

      if (!sessionId) {
        return json({
          success: false,
          error: "Please login to comment"
        }, 401);
      }


      // ---------------------------------------------------
      // FIND USER FROM SESSION
      // ---------------------------------------------------

      const session = await DB.prepare(`
        SELECT
          s.user_id,
          s.expires_at
        FROM sessions s
        WHERE s.id = ?
        LIMIT 1
      `)
      .bind(sessionId)
      .first();

      if (!session) {
        return json({
          success: false,
          error: "Invalid session. Please login again."
        }, 401);
      }


      // ---------------------------------------------------
      // CHECK SESSION EXPIRY
      // ---------------------------------------------------

      if (
        session.expires_at &&
        new Date(session.expires_at).getTime()
          < Date.now()
      ) {
        return json({
          success: false,
          error: "Session expired. Please login again."
        }, 401);
      }


      const userId =
        Number(session.user_id);

      if (!userId) {
        return json({
          success: false,
          error: "Invalid user session"
        }, 401);
      }


      // ---------------------------------------------------
      // READ FORM DATA
      // ---------------------------------------------------

      const formData =
        await request.formData();

      const action =
        String(
          formData.get("action") || "create"
        ).trim();

      const postId =
        Number(
          formData.get("post_id")
        );

      const commentText =
        String(
          formData.get("comment_text") || ""
        ).trim();


      // ---------------------------------------------------
      // DELETE COMMENT
      // ---------------------------------------------------

      if (action === "delete") {

        const commentId =
          Number(
            formData.get("comment_id")
          );

        if (!commentId) {
          return json({
            success: false,
            error: "comment_id is required"
          }, 400);
        }

        const deleted =
          await DB.prepare(`
            DELETE FROM boost_post_comments
            WHERE id = ?
              AND user_id = ?
          `)
          .bind(
            commentId,
            userId
          )
          .run();

        if (!deleted.meta.changes) {
          return json({
            success: false,
            error: "Comment not found"
          }, 404);
        }

        return json({
          success: true,
          message: "Comment deleted"
        });
      }


      // ---------------------------------------------------
      // CREATE COMMENT VALIDATION
      // ---------------------------------------------------

      if (!postId) {
        return json({
          success: false,
          error: "post_id is required"
        }, 400);
      }

      if (!commentText) {
        return json({
          success: false,
          error: "Comment cannot be empty"
        }, 400);
      }

      if (commentText.length > 1000) {
        return json({
          success: false,
          error: "Comment is too long"
        }, 400);
      }


      // ---------------------------------------------------
      // CHECK POST EXISTS
      // ---------------------------------------------------

      const post =
        await DB.prepare(`
          SELECT
            id
          FROM boost_posts
          WHERE id = ?
          LIMIT 1
        `)
        .bind(postId)
        .first();

      if (!post) {
        return json({
          success: false,
          error: "Post not found"
        }, 404);
      }


      // ---------------------------------------------------
      // SAVE COMMENT
      // ---------------------------------------------------

      const now =
        new Date().toISOString();

      const inserted =
        await DB.prepare(`
          INSERT INTO boost_post_comments
          (
            post_id,
            user_id,
            comment_text,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          postId,
          userId,
          commentText,
          now,
          now
        )
        .run();


      // ---------------------------------------------------
      // UPDATE COMMENT COUNT
      // ---------------------------------------------------

      await DB.prepare(`
        UPDATE boost_posts
        SET comments_count =
          COALESCE(comments_count, 0) + 1
        WHERE id = ?
      `)
      .bind(postId)
      .run();


      // ---------------------------------------------------
      // GET CREATED COMMENT
      // ---------------------------------------------------

      const comment =
        await DB.prepare(`
          SELECT
            c.id,
            c.post_id,
            c.user_id,
            c.comment_text,
            c.created_at,
            u.full_name
          FROM boost_post_comments c
          LEFT JOIN users u
            ON u.id = c.user_id
          WHERE c.id = ?
          LIMIT 1
        `)
        .bind(inserted.meta.last_row_id)
        .first();


      return json({
        success: true,
        message: "Comment added",
        comment: comment || null
      });
    }


    return json({
      success: false,
      error: "Method not allowed"
    }, 405);


  } catch (error) {

    console.error(
      "Boost comments error:",
      error
    );

    return json({
      success: false,
      error: "Comment system error",
      details: error.message
    }, 500);
  }
}


// =======================================================
// JSON RESPONSE
// =======================================================

function json(data, status = 200) {

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}
