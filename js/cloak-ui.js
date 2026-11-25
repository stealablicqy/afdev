/* Tab disguise panel for the hub shell. /go/ has its own copy wired into its
   chrome; this keeps the hub's topbar control in sync with the same presets. */
(function () {
	"use strict";

	function ready(fn) {
		if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
		else fn();
	}

	ready(() => {
		const cloak = window.AFCloak;
		const wrap = document.querySelector(".cloak-wrap");
		const button = document.getElementById("cloakBtn");
		const menu = document.getElementById("cloakMenu");
		const list = document.getElementById("cloakList");
		const panic = document.getElementById("cloakPanic");
		if (!cloak || !wrap || !button || !menu || !list || !panic) return;

		function activeId() {
			return cloak.current()?.id || "off";
		}

		function build() {
			const active = activeId();
			list.replaceChildren();
			for (const preset of [{ id: "off", name: "Off" }, ...cloak.presets]) {
				const item = document.createElement("button");
				item.type = "button";
				item.className = `cloak-item${preset.id === active ? " is-active" : ""}`;
				item.textContent = preset.name;
				item.addEventListener("click", () => {
					cloak.apply(preset.id === "off" ? null : preset);
					build();
					close();
				});
				list.appendChild(item);
			}

			panic.replaceChildren();
			for (const preset of cloak.presets) {
				const option = document.createElement("option");
				option.value = preset.id;
				option.textContent = preset.name;
				if (cloak.getPanic() === preset.id) option.selected = true;
				panic.appendChild(option);
			}
		}

		function open() {
			build();
			menu.hidden = false;
			button.setAttribute("aria-expanded", "true");
		}

		function close() {
			menu.hidden = true;
			button.setAttribute("aria-expanded", "false");
		}

		button.addEventListener("click", (event) => {
			event.stopPropagation();
			if (menu.hidden) open();
			else close();
		});

		panic.addEventListener("change", () => cloak.setPanic(panic.value));

		document.addEventListener("click", (event) => {
			if (menu.hidden) return;
			if (event.target.closest(".cloak-wrap")) return;
			close();
		});

		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && !menu.hidden) close();
		});
	});
})();
