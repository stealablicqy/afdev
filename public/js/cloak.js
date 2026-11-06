/* Tab cloaker — swaps the document title and favicon so the tab reads like a
   school tool. Shared by the hub shell and the /go/ proxy page. */
(function () {
	"use strict";

	const PRESETS = [
		{
			id: "classroom",
			name: "Google Classroom",
			title: "Classes",
			color: "#1a73e8",
			letter: "C",
		},
		{
			id: "docs",
			name: "Google Docs",
			title: "Untitled document - Google Docs",
			color: "#4285f4",
			letter: "D",
		},
		{
			id: "ixl",
			name: "IXL",
			title: "IXL | Math, Language Arts, Science, Social Studies",
			color: "#ff8b00",
			letter: "I",
		},
		{
			id: "drive",
			name: "Google Drive",
			title: "My Drive - Google Drive",
			color: "#0f9d58",
			letter: "▤",
		},
		{
			id: "quizlet",
			name: "Quizlet",
			title: "Flashcards, learning tools and textbook solutions | Quizlet",
			color: "#4255ff",
			letter: "Q",
		},
		{
			id: "canvas",
			name: "Canvas",
			title: "Dashboard",
			color: "#e0342b",
			letter: "◈",
		},
	];

	const STORAGE_KEY = "af.cloak.preset";
	const PANIC_KEY = "af.cloak.panic";
	const AUTO_KEY = "af.cloak.auto";

	let original = null;
	let applied = null;

	function iconFor(preset) {
		const svg =
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
			`<rect width="64" height="64" rx="14" fill="${preset.color}"/>` +
			`<text x="32" y="44" font-family="Arial,Helvetica,sans-serif" font-size="34"` +
			` font-weight="700" fill="#ffffff" text-anchor="middle">${preset.letter}</text></svg>`;
		return "data:image/svg+xml," + encodeURIComponent(svg);
	}

	function setFavicon(href) {
		let link = document.querySelector('link[rel="icon"]');
		if (!link) {
			link = document.createElement("link");
			link.rel = "icon";
			document.head.appendChild(link);
		}
		link.type = "image/svg+xml";
		link.href = href;
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
			if (persist) localStorage.removeItem(STORAGE_KEY);
			return null;
		}

		applied = preset;
		document.title = preset.title;
		setFavicon(iconFor(preset));
		if (persist) localStorage.setItem(STORAGE_KEY, preset.id);
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
	}

	function panic() {
		const preset = find(localStorage.getItem(PANIC_KEY)) || find("classroom");
		apply(preset, { persist: false });
	}

	document.addEventListener("keydown", (event) => {
		if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "x") {
			event.preventDefault();
			panic();
		}
	});

	function boot() {
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
