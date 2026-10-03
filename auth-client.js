(function () {
  const protectedPages = new Set([
    "advisor.html",
    "ask.html",
    "checklist.html",
    "home.html",
    "notifications.html",
    "onboarding.html",
    "profile.html",
    "referral.html",
    "scholarships.html",
    "sop-reviewer.html",
    "templates.html",
    "tracker.html",
    "visa-travel.html",
  ]);
  const authPage = location.pathname.endsWith("/login.html");
  let syncTimer;
  let syncing = false;

  function jsonFromStorage(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  }

  function rewriteLandingLinks() {
    document.querySelectorAll("a[href]").forEach((link) => {
      let target;
      try {
        target = new URL(link.href, location.href);
      } catch {
        return;
      }

      if (/\/auth\/(?:login|signup)\/?$/.test(target.pathname)) {
        link.href = "/login.html";
      } else if (/\/dashboard\/?$/.test(target.pathname)) {
        link.href = "/home.html";
      }
    });
  }

  function isLandingPage() {
    return ["index.html", "updated_idex.html", "updated_index.html"].includes(location.pathname.split("/").pop());
  }

  function pageData() {
    const data = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || /^(?:sb-|sm-auth)/i.test(key)) continue;
      const value = localStorage.getItem(key);
      if (typeof value === "string") data[key] = value;
    }
    return data;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The request could not be completed.");
    return result;
  }

  async function syncData() {
    if (syncing || !protectedPages.has(location.pathname.split("/").pop())) return;
    syncing = true;
    try {
      await api("/api/data", {
        method: "PUT",
        body: JSON.stringify({ data: pageData() }),
      });
    } catch (error) {
      console.warn("ScholarMatched data sync failed:", error.message);
    } finally {
      syncing = false;
    }
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncData, 350);
  }

  function watchStorage() {
    for (const method of ["setItem", "removeItem", "clear"]) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        const result = original.apply(this, args);
        if (this === localStorage) scheduleSync();
        return result;
      };
    }
    window.addEventListener("pagehide", () => {
      if (protectedPages.has(location.pathname.split("/").pop())) {
        navigator.sendBeacon("/api/data", new Blob([JSON.stringify({ data: pageData() })], { type: "application/json" }));
      }
    });
  }

  function applyDemoProfile(data, user) {
    const profile = jsonFromStorage("scholarMatchedProfile") || {};
    const onboarding = jsonFromStorage("onboardingData") || {};
    const name = profile.fullName || onboarding.name || user.name || "Student";
    const email = profile.email || onboarding.email || user.email;
    const initials = name.split(/\s+/).filter(Boolean).map((word) => word[0]).join("").slice(0, 2).toUpperCase() || "S";

    for (const selector of [".profile-name", "#userName", "#topName", "#profileName"]) {
      document.querySelectorAll(selector).forEach((element) => { element.textContent = name; });
    }
    for (const selector of [".avatar", "#avatar", "#topAvatar", "#largeAvatar"]) {
      document.querySelectorAll(selector).forEach((element) => { element.textContent = initials; });
    }
    const emailElement = document.querySelector("#profileEmail");
    if (emailElement) emailElement.textContent = email;

    const stats = document.querySelectorAll(".stat-card .stat-number");
    if (stats.length >= 4) {
      stats[0].textContent = String(data.scholarshipsTotal ?? 0);
      stats[1].textContent = String((jsonFromStorage("scholarMatchedSavedScholarships") || []).length);
      stats[2].textContent = String((jsonFromStorage("scholarMatchedApplications") || []).length);
      const profileFields = ["country", "degree", "field", "cgpa", "studyLevel", "funding", "destination", "interest", "goals"];
      const filled = profileFields.filter((field) => String(profile[field] || onboarding[field] || "").trim()).length;
      stats[3].textContent = `${Math.round(filled / profileFields.length * 100)}%`;
    }

    const welcome = document.querySelector(".welcome h1");
    if (welcome) welcome.textContent = `Welcome back, ${name}!`;
  }

  async function loadDashboard(user) {
    if (!location.pathname.endsWith("/home.html")) return;
    try {
      const result = await api("/api/scholarships?limit=3");
      const stats = document.querySelectorAll(".stat-card .stat-number");
      if (stats.length) stats[0].textContent = String(result.total);
      const cards = [...document.querySelectorAll(".scholarship")];
      (result.data || []).slice(0, cards.length).forEach((item, index) => {
        const card = cards[index];
        const name = card.querySelector(".scholarship-name");
        const provider = card.querySelector(".scholarship-provider");
        if (name) name.textContent = item.scholarship_name;
        if (provider) provider.textContent = item.provider || item.country || "Scholarship provider";
        const meta = card.querySelectorAll(".scholarship-meta span");
        if (meta[0]) meta[0].textContent = item.country || "Multiple countries";
        if (meta[1]) meta[1].textContent = item.degree_level || "All degree levels";
        if (meta[2]) meta[2].textContent = item.funding_type || "Funding details available";
      });
      applyDemoProfile({ scholarshipsTotal: result.total }, user);
    } catch (error) {
      console.warn("ScholarMatched dashboard could not load:", error.message);
    }
  }

  function restorePageData(user, data) {
    for (const name of ["loadUser", "loadProfile", "loadChecklist", "loadSavedAnswers", "loadTemplates", "restoreApplications"]) {
      if (typeof window[name] === "function") {
        try { window[name](); } catch (error) { console.warn(`Could not restore ${name}:`, error); }
      }
    }
    window.dispatchEvent(new CustomEvent("scholarMatchedReady", { detail: { user, data } }));
  }

  async function initLogin() {
    const form = document.getElementById("loginForm");
    if (!form) return;
    const message = document.getElementById("loginMessage");
    const submit = form.querySelector("button[type=submit]");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      message.textContent = "";
      submit.disabled = true;
      try {
        const result = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: form.elements.email.value,
            password: form.elements.password.value,
          }),
        });
        const next = new URLSearchParams(location.search).get("next") || "/home.html";
        location.assign(next.startsWith("/") && !next.startsWith("//") ? next : "/home.html");
      } catch (error) {
        message.textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    });
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
    localStorage.clear();
    location.assign("/index.html");
  }

  window.scholarMatchedAuth = { api, logout };
  window.logout = logout;

  rewriteLandingLinks();
  if (isLandingPage()) {
    new MutationObserver(rewriteLandingLinks).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (authPage) {
    initLogin();
    api("/api/auth/session").then((session) => {
      if (session.authenticated) location.replace("/home.html");
    }).catch(() => {});
    return;
  }

  if (!protectedPages.has(location.pathname.split("/").pop())) return;

  api("/api/auth/session").then(async (session) => {
    if (!session.authenticated) {
      location.replace(`/login.html?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
      return;
    }

    const response = await api("/api/data");
    const data = response.data || {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string") localStorage.setItem(key, value);
    }
    watchStorage();
    restorePageData(session.user, data);
    applyDemoProfile({}, session.user);
    await loadDashboard(session.user);
    if (location.pathname.endsWith("/scholarships.html")) {
      window.dispatchEvent(new Event("scholarMatchedReady"));
    }
  }).catch((error) => {
    console.error("ScholarMatched could not load your session:", error.message);
    location.replace(`/login.html?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
  });
})();