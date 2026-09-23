export async function onRequest(context) {

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>Boostly Dashboard</title>

<style>
*{
  box-sizing:border-box;
  margin:0;
  padding:0;
}

body{
  font-family:Arial,Helvetica,sans-serif;
  background:#f5f7fb;
  color:#172033;
}

header{
  background:#fff;
  border-bottom:1px solid #e8ebf2;
  padding:15px 20px;
  position:sticky;
  top:0;
  z-index:10;
}

.nav{
  max-width:1100px;
  margin:auto;
  display:flex;
  align-items:center;
  justify-content:space-between;
}

.logo{
  font-size:25px;
  font-weight:800;
  color:#6c4cff;
}

.navlinks{
  display:flex;
  gap:20px;
  align-items:center;
}

.navlinks a{
  text-decoration:none;
  color:#172033;
  font-weight:600;
}

.logout{
  border:0;
  background:#172033;
  color:#fff;
  padding:10px 16px;
  border-radius:9px;
  cursor:pointer;
}

.container{
  max-width:1100px;
  margin:30px auto;
  padding:0 18px;
}

.welcome{
  margin-bottom:25px;
}

.welcome h1{
  font-size:30px;
  margin-bottom:8px;
}

.welcome p{
  color:#687086;
}

.stats{
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:18px;
  margin-bottom:25px;
}

.stat{
  background:#fff;
  border:1px solid #e8ebf2;
  border-radius:16px;
  padding:22px;
}

.stat strong{
  display:block;
  font-size:28px;
  margin-top:8px;
}

.card{
  background:#fff;
  border:1px solid #e8ebf2;
  border-radius:18px;
  padding:25px;
  margin-bottom:22px;
}

.card h2{
  margin-bottom:18px;
}

.business{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:20px;
}

.business-info h3{
  font-size:24px;
  margin-bottom:7px;
}

.business-info p{
  color:#687086;
  margin:5px 0;
}

.buttons{
  display:flex;
  gap:10px;
  flex-wrap:wrap;
}

.btn{
  display:inline-block;
  text-decoration:none;
  padding:11px 17px;
  border-radius:9px;
  font-weight:700;
  cursor:pointer;
  border:0;
}

.primary{
  background:#6c4cff;
  color:#fff;
}

.secondary{
  background:#eef0f7;
  color:#172033;
}

.empty{
  text-align:center;
  padding:25px 10px;
}

.empty p{
  color:#687086;
  margin:10px 0 18px;
}

.message{
  background:#fff3cd;
  padding:15px;
  border-radius:10px;
  color:#725400;
}

.loading{
  color:#687086;
}

@media(max-width:700px){

  .navlinks a{
    display:none;
  }

  .stats{
    grid-template-columns:1fr;
  }

  .business{
    flex-direction:column;
    align-items:flex-start;
  }

  .welcome h1{
    font-size:25px;
  }
}
</style>
</head>

<body>

<header>
  <div class="nav">

    <div class="logo">Boostly</div>

    <div class="navlinks">
      <a href="/">Home</a>
      <a href="/explore.html">Explore</a>
      <button class="logout" id="logoutBtn">Logout</button>
    </div>

  </div>
</header>

<main class="container">

  <section class="welcome">
    <h1 id="welcomeTitle">Welcome to Boostly 👋</h1>
    <p>Manage your business profile and grow your local presence.</p>
  </section>

  <section class="stats">

    <div class="stat">
      Profile Views
      <strong>0</strong>
    </div>

    <div class="stat">
      Enquiries
      <strong>0</strong>
    </div>

    <div class="stat">
      Rating
      <strong>—</strong>
    </div>

  </section>

  <section class="card">

    <h2>Your Business</h2>

    <div id="businessArea">
      <div class="loading">Loading your business...</div>
    </div>

  </section>

  <section class="card">

    <h2>Quick Actions</h2>

    <div class="buttons">

      <a href="/business-profile.html" class="btn primary">
        Edit Business Profile
      </a>

      <a href="/explore.html" class="btn secondary">
        Explore Businesses
      </a>

    </div>

  </section>

</main>

<script>

async function loadDashboard(){

  const businessArea =
    document.getElementById("businessArea");

  try{

    const meResponse =
      await fetch("/api/me", {
        credentials:"include"
      });

    if(!meResponse.ok){

      window.location.href="/login.html";
      return;
    }

    let me = null;

    try{
      me = await meResponse.json();
    }catch(e){}

    if(me && me.name){

      document.getElementById("welcomeTitle").textContent =
        "Welcome, " + me.name + " 👋";

    }

    const response =
      await fetch("/api/my-business", {
        credentials:"include"
      });

    if(response.status === 401){

      window.location.href="/login.html";
      return;
    }

    if(response.status === 404){

      businessArea.innerHTML = \`
        <div class="empty">

          <h3>No Business Profile Yet</h3>

          <p>
            Create your business profile to start
            appearing on Boostly.
          </p>

          <a
            href="/business-profile.html"
            class="btn primary">
            Create Business Profile
          </a>

        </div>
      \`;

      return;
    }

    if(!response.ok){

      throw new Error("Business request failed");

    }

    const business =
      await response.json();

    businessArea.innerHTML = \`

      <div class="business">

        <div class="business-info">

          <h3>
            \${business.business_name || "Your Business"}
          </h3>

          <p>
            <strong>Category:</strong>
            \${business.category || "—"}
          </p>

          <p>
            <strong>City:</strong>
            \${business.city || "—"}
          </p>

          <p>
            <strong>Phone:</strong>
            \${business.phone || "Not added"}
          </p>

        </div>

        <div class="buttons">

          <a
            href="/business-profile.html"
            class="btn primary">
            Edit Profile
          </a>

          <a
            href="/business.html?id=\${encodeURIComponent(business.id)}"
            class="btn secondary">
            View Public Profile
          </a>

        </div>

      </div>
    \`;

  }catch(error){

    businessArea.innerHTML = \`
      <div class="message">
        Dashboard could not load your business information.
        Please refresh and try again.
      </div>
    \`;

  }

}


document
  .getElementById("logoutBtn")
  .addEventListener("click", async function(){

    try{

      await fetch("/api/logout",{
        method:"POST",
        credentials:"include"
      });

    }catch(e){}

    window.location.href="/login.html";

  });


loadDashboard();

</script>

</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=UTF-8"
    }
  });
}
