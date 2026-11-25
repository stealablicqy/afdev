/* Tab cloaker — swaps the document title and favicon so the tab reads like a
   school tool. Shared by the hub shell, the /go/ proxy page and index.svg.
   Each preset carries its own brand artwork so the tab icon matches the site it
   is imitating instead of a generated letter tile. */
(function () {
  "use strict";

  // Artwork is written as inner SVG markup on a 64x64 grid and wrapped in a
  // round-cornered plate below. Colours are the published brand colours.
  const PRESETS = [
    {
      id: "classroom",
      name: "Google Classroom",
      title: "Classes",
      color: "#0f9d58",
      svg:
        '<rect width="64" height="64" rx="14" fill="#0f9d58"/>' +
        '<rect x="14" y="16" width="36" height="26" rx="4" fill="#ffffff"/>' +
        '<rect x="18" y="20" width="28" height="18" rx="2" fill="#0f9d58"/>' +
        '<rect x="22" y="25" width="14" height="2.6" rx="1.3" fill="#ffe082"/>' +
        '<rect x="22" y="30" width="10" height="2.6" rx="1.3" fill="#ffffff" fill-opacity=".85"/>' +
        '<rect x="24" y="42" width="16" height="3.4" rx="1.7" fill="#e8f5e9"/>' +
        '<circle cx="32" cy="51.5" r="2.6" fill="#ffe082"/>'
    },
    {
      id: "docs",
      name: "Google Docs",
      title: "Untitled document - Google Docs",
      color: "#4285f4",
      svg:
        '<rect width="64" height="64" rx="14" fill="#ffffff"/>' +
        '<path d="M20 10h17l11 11v33a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z" fill="#4285f4"/>' +
        '<path d="M37 10l11 11H37z" fill="#a1c2fa"/>' +
        '<rect x="23" y="30" width="20" height="3" rx="1.5" fill="#ffffff"/>' +
        '<rect x="23" y="37" width="20" height="3" rx="1.5" fill="#ffffff"/>' +
        '<rect x="23" y="44" width="13" height="3" rx="1.5" fill="#ffffff"/>'
    },
    {
      id: "drive",
      name: "Google Drive",
      title: "My Drive - Google Drive",
      color: "#0f9d58",
      svg:
        '<rect width="64" height="64" rx="14" fill="#ffffff"/>' +
        '<path d="M24.5 12h15l12.5 22h-15z" fill="#fbbc04"/>' +
        '<path d="M24.5 12L12 34l7.5 13L32 25z" fill="#0f9d58"/>' +
        '<path d="M19.5 47h25L52 34H27z" fill="#4285f4"/>'
    },
    {
      id: "ixl",
      name: "IXL",
      title: "IXL | Math, Language Arts, Science, Social Studies",
      color: "#ff8b00",
      svg:
        '<rect width="64" height="64" rx="14" fill="#ff8b00"/>' +
        '<rect x="12" y="24" width="6" height="20" rx="2" fill="#ffffff"/>' +
        '<path d="M24 44L32 20l8 24" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<rect x="43" y="24" width="6" height="20" rx="2" fill="#ffffff"/>'
    },
    {
      id: "quizlet",
      name: "Quizlet",
      title: "Flashcards, learning tools and textbook solutions | Quizlet",
      color: "#4255ff",
      svg:
        '<rect width="64" height="64" rx="14" fill="#4255ff"/>' +
        '<rect x="15" y="15" width="34" height="34" rx="7" fill="#ffffff"/>' +
        '<rect x="19" y="19" width="26" height="26" rx="5" fill="#4255ff"/>' +
        '<circle cx="32" cy="32" r="7" fill="none" stroke="#ffffff" stroke-width="4.2"/>' +
        '<rect x="36" y="36" width="9" height="4.2" rx="2.1" fill="#ffffff" transform="rotate(45 40.5 38.1)"/>'
    },
    {
      id: "canvas",
      name: "Canvas",
      title: "Dashboard",
      color: "#e0342b",
      svg:
        '<rect width="64" height="64" rx="14" fill="#e0342b"/>' +
        '<path d="M46 24a17 17 0 1 0 0 16" fill="none" stroke="#ffffff" stroke-width="6.4" stroke-linecap="round"/>' +
        '<circle cx="45" cy="32" r="3.4" fill="#ffffff"/>'
    },
    {
      id: "khan",
      name: "Khan Academy",
      title: "Khan Academy | Free Online Courses, Lessons & Practice",
      color: "#14bf96",
      svg:
        '<rect width="64" height="64" rx="14" fill="#ffffff"/>' +
        '<path d="M32 12c11 0 18 7 18 14 0 10-9 13-9 19 0 5 3 7 3 7-9 0-13-6-13-12 0-7 8-9 8-15 0-4-3-6-7-6-5 0-7 3-7 3l-4-6c3-3 6-4 11-4z" fill="#14bf96"/>'
    },
    {
      id: "gmail",
      name: "Gmail",
      title: "Inbox (3) - student@school.edu - Gmail",
      color: "#ea4335",
      svg:
        '<rect width="64" height="64" rx="14" fill="#ffffff"/>' +
        '<path d="M13 22l19 14 19-14v20a4 4 0 0 1-4 4H17a4 4 0 0 1-4-4z" fill="#ea4335"/>' +
        '<path d="M13 22v-2a4 4 0 0 1 6.4-3.2L32 29l12.6-12.2A4 4 0 0 1 51 20v2L32 36z" fill="#c5221f"/>' +
        '<path d="M13 22l19 14 19-14" fill="none" stroke="#ffffff" stroke-width="1.2" stroke-opacity=".35"/>'
    },
    {
      id: "google",
      name: "Google",
      title: "Google",
      color: "#4285f4",
      svg:
        '<rect width="64" height="64" rx="14" fill="#ffffff"/>' +
        '<path d="M49 32c0-1.2-.1-2.3-.3-3.4H32v6.5h9.6a8.2 8.2 0 0 1-3.6 5.4v4.5h5.8c3.4-3.1 5.2-7.7 5.2-13z" fill="#4285f4"/>' +
        '<path d="M32 50c4.6 0 8.5-1.5 11.3-4.1l-5.5-4.3c-1.5 1-3.5 1.7-5.8 1.7-4.5 0-8.3-3-9.6-7.1H16.6v4.5A18 18 0 0 0 32 50z" fill="#34a853"/>' +
        '<path d="M22.4 36.2a10.8 10.8 0 0 1 0-6.8v-4.6H16.6a18 18 0 0 0 0 16z" fill="#fbbc04"/>' +
        '<path d="M32 20.6c2.5 0 4.7.9 6.5 2.6l4.7-4.7A17 17 0 0 0 32 14a18 18 0 0 0-15.4 8.8l5.8 4.6c1.3-4.1 5.1-6.8 9.6-6.8z" fill="#ea4335"/>'
    },
    {
      id: "wikipedia",
      name: "Wikipedia",
      title: "Wikipedia, the free encyclopedia",
      color: "#000000",
      svg:
        '<rect width="64" height="64" rx="14" fill="#ffffff"/>' +
        '<text x="32" y="45" font-family="Georgia,Times New Roman,serif" font-size="34" font-weight="700" fill="#111" text-anchor="middle">W</text>'
    },
    {
      id: "schoology",
      name: "Schoology",
      title: "Home | Schoology",
      color: "#0f7dbf",
      svg:
        '<rect width="64" height="64" rx="14" fill="#0f7dbf"/>' +
        '<path d="M43 22c-2.4-3-6.1-4.6-10.2-4.6-6.2 0-10.6 3-10.6 7.8 0 4.2 3.2 6.4 9.2 7.6 4.6 1 6 1.7 6 3.2 0 1.7-1.8 2.7-4.8 2.7-3.4 0-6.2-1.3-8.4-3.6l-3.4 4.6C24 43.5 28.4 45.6 33 45.6c6.6 0 11.2-3.2 11.2-8.2 0-4.4-3-6.6-9.4-7.8-4.4-.9-5.8-1.6-5.8-3 0-1.4 1.7-2.4 4.4-2.4 2.7 0 5 1 6.8 2.8z" fill="#ffffff"/>'
    }
  ];

  const STORAGE_KEY = "af.cloak.preset";
  const PANIC_KEY = "af.cloak.panic";
  const AUTO_KEY = "af.cloak.auto";

  let original = null;
  let applied = null;

  // ChromeOS tab strips are the reason this cache exists. An image/svg+xml data
  // URI is valid but several Chromebook builds render it as a blank tile, which
  // is what made the disguise look wrong. Every preset is rasterised to a real
  // PNG once at boot and the PNG is what gets installed.
  const pngCache = new Map();

  function svgData(preset) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">' +
      preset.svg +
      "</svg>";
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  function iconFor(preset) {
    return pngCache.get(preset.id) || svgData(preset);
  }

  function rasterize(preset) {
    if (pngCache.has(preset.id)) return Promise.resolve(pngCache.get(preset.id));
    return new Promise((resolve) => {
      const image = new Image();
      image.decoding = "sync";
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 64;
          canvas.height = 64;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, 64, 64);
          const png = canvas.toDataURL("image/png");
          pngCache.set(preset.id, png);
          resolve(png);
        } catch (error) {
          // Tainted canvas: keep the vector and move on.
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = svgData(preset);
    });
  }

  function setFavicon(href) {
    let link = document.querySelector('link[rel~="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = href.startsWith("data:image/png") ? "image/png" : "image/svg+xml";
    link.setAttribute("sizes", href.startsWith("data:image/png") ? "64x64" : "any");
    link.href = href;
  }

  // On the CDN build the hub runs inside an iframe owned by index.svg, so the
  // tab title belongs to that parent document, not this one. Guardian/Hapara
  // read the parent's title, so every change is posted up; index.svg owns the
  // baseline title and repaints it when the cloak is turned off.
  function mirror(preset) {
    const payload = {
      af: "cloak",
      title: preset ? preset.title : null,
      icon: preset ? iconFor(preset) : null,
    };
    try {
      window.parent.postMessage(payload, "*");
    } catch (error) {
      /* no parent to talk to */
    }
  }

  function apply(preset, options) {
    const persist = !options || options.persist !== false;
    // Callers pass either a preset or its id; accepting both keeps a stale
    // saved id from writing "undefined" into the tab title.
    if (typeof preset === "string") preset = find(preset);
    if (!original) {
      original = {
        title: document.title,
        icon: document.querySelector('link[rel="icon"]')?.href || "",
      };
    }

    if (!preset || preset.id === "off") {
      applied = null;
      document.title = original.title;
      if (original.icon) setFavicon(original.icon);
      mirror(null);
      if (persist) localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    applied = preset;
    document.title = preset.title;
    setFavicon(iconFor(preset));
    rasterize(preset).then((png) => {
      if (png && applied === preset) setFavicon(png);
    });
    mirror(preset);
    if (persist) localStorage.setItem(STORAGE_KEY, preset.id);
    try {
      document.dispatchEvent(new CustomEvent("af-cloak-change", { detail: preset }));
    } catch (error) {
      /* ancient engine without CustomEvent */
    }
    return preset;
  }

  function find(id) {
    return PRESETS.find((preset) => preset.id === id) || null;
  }

  function current() {
    return applied;
  }

  function restore() {
    if (!original) return;
    document.title = original.title;
    if (original.icon) setFavicon(original.icon);
    mirror(null);
  }

  function panic() {
    const preset = find(localStorage.getItem(PANIC_KEY)) || find("classroom");
    apply(preset, { persist: false });
  }

  function boot() {
    // Warm every preset so switching a disguise is a paint, not a decode.
    PRESETS.forEach((preset) => {
      try {
        rasterize(preset);
      } catch (error) {
        /* canvas unavailable */
      }
    });
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) apply(find(saved), { persist: false });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  window.AFCloak = {
    presets: PRESETS,
    iconFor,
    rasterize,
    apply,
    current,
    find,
    panic,
    restore,
    setPanic(id) {
      localStorage.setItem(PANIC_KEY, id);
    },
    getPanic() {
      return localStorage.getItem(PANIC_KEY) || "classroom";
    },
    setAuto(on) {
      localStorage.setItem(AUTO_KEY, on ? "1" : "0");
    },
    getAuto() {
      return localStorage.getItem(AUTO_KEY) !== "0";
    },
  };
})();
