export async function onRequestPost(context) {
  try {
    const formData = await context.request.formData();

    const email = String(formData.get("email") || "")
      .trim()
      .toLowerCase();

    const password = String(formData.get("password") || "");

    if (!email || !password) {
      return new Response("Email and password are required.", {
        status: 400
      });
    }

    const user = await context.env.DB
      .prepare(`
        SELECT id, full_name, email, password_hash, account_type
        FROM users
        WHERE email = ?
      `)
      .bind(email)
      .first();

    if (!user) {
      return new Response("Invalid email or password.", {
        status: 401
      });
    }

    const storedPassword = String(user.password_hash || "");
    const parts = storedPassword.split(":");

    if (parts.length !== 2) {
      return new Response("Invalid account password data.", {
        status: 500
      });
    }

    const salt = parts[0];
    const storedHash = parts[1];

    const encoder = new TextEncoder();

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: encoder.encode(salt),
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      256
    );

    const hashArray = Array.from(new Uint8Array(derivedBits));

    const calculatedHash = hashArray
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");

    if (calculatedHash !== storedHash) {
      return new Response("Invalid email or password.", {
        status: 401
      });
    }

    return Response.redirect(
      new URL(
        "/dashboard.html?user=" + encodeURIComponent(user.id),
        context.request.url
      ),
      303
    );

  } catch (error) {
    return new Response("Login failed: " + error.message, {
      status: 500
    });
  }
}
