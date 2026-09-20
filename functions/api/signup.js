export async function onRequestPost(context) {
  try {
    const formData = await context.request.formData();

    const fullName = String(formData.get("fullName") || "").trim();
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const phone = String(formData.get("phone") || "").trim();
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    const accountType = String(formData.get("accountType") || "");
    const city = String(formData.get("city") || "").trim();

    if (!fullName || !email || !password || !confirmPassword || !accountType) {
      return new Response("Please fill all required fields.", {
        status: 400
      });
    }

    if (password !== confirmPassword) {
      return new Response("Passwords do not match.", {
        status: 400
      });
    }

    if (password.length < 6) {
      return new Response("Password must be at least 6 characters.", {
        status: 400
      });
    }

    if (!["customer", "business"].includes(accountType)) {
      return new Response("Invalid account type.", {
        status: 400
      });
    }

    const existingUser = await context.env.DB
      .prepare("SELECT id FROM users WHERE email = ?")
      .bind(email)
      .first();

    if (existingUser) {
      return new Response("An account with this email already exists.", {
        status: 409
      });
    }

    const salt = crypto.randomUUID();

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
    const passwordHash = hashArray
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");

    const storedPassword = `${salt}:${passwordHash}`;

    await context.env.DB
      .prepare(`
        INSERT INTO users
        (full_name, email, phone, password_hash, account_type, city)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        fullName,
        email,
        phone || null,
        storedPassword,
        accountType,
        city || null
      )
      .run();

    return Response.redirect(
      new URL("/login.html?signup=success", context.request.url),
      303
    );

  } catch (error) {
    return new Response("Signup failed: " + error.message, {
      status: 500
    });
  }
}
