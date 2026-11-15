/* Camera page shell (was inline in index.html; moved out so the page works under a
 * strict Content-Security-Policy with no 'unsafe-inline' scripts). */
      // "More" bottom sheet: reuses the sidebar. Closes on scrim tap, Esc or link tap.
      (function () {
        var btn = document.getElementById("more-btn");
        var sheet = document.querySelector(".sidebar");
        var scrim = document.querySelector(".sheet-scrim");
        sheet.id = "camera-sheet";
        function setOpen(open) {
          document.body.classList.toggle("sheet-open", open);
          scrim.hidden = !open;
          btn.setAttribute("aria-expanded", String(open));
          btn.classList.toggle("is-open", open);
          if (open) { var first = sheet.querySelector("a"); if (first) first.focus(); }
          else if (sheet.contains(document.activeElement)) btn.focus();
        }
        btn.addEventListener("click", function () { setOpen(!document.body.classList.contains("sheet-open")); });
        scrim.addEventListener("click", function () { setOpen(false); });
        sheet.addEventListener("click", function (e) { if (e.target.closest("a")) setOpen(false); });
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });
        window.addEventListener("resize", function () { if (window.innerWidth > 1000) setOpen(false); });
        window.__boopsHandleBack = function () {
          if (document.body.classList.contains("sheet-open")) {
            setOpen(false);
            return true;
          }
          return false;
        };
      })();

      (function () {
        var names = { A1: "Amara Okafor", A2: "Jun Park", A3: "Lena Fischer" };
        var astro = "A1";
        var day = null;
        try {
          var q = new URLSearchParams(window.location.search).get("astronaut");
          var storedCtx = localStorage.getItem("boops_v1_context");
          if (storedCtx) {
            var parsed = JSON.parse(storedCtx);
            if (parsed && parsed.astronautId && names[parsed.astronautId]) astro = parsed.astronautId;
            if (parsed && typeof parsed.missionDay === "number") day = parsed.missionDay;
          }
          var cur = localStorage.getItem("ahm.current_astronaut");
          if (cur && names[cur]) astro = cur;
          if (q && names[q]) astro = q;
          // "My data" mode: one person only, never a demo crew name.
          if (localStorage.getItem("boops.data_mode") === "mine") {
            var prof = JSON.parse(localStorage.getItem("boops.personal_profile") || "null");
            astro = "Self";
            names.Self = (prof && typeof prof.name === "string" && prof.name) || "You";
          }
        } catch (e) {}
        var idEl = document.getElementById("astronaut-id");
        var nameEl = document.getElementById("astronaut-name");
        var dayEl = document.getElementById("camera-mission-day");
        if (idEl && (!idEl.textContent || astro === "Self")) idEl.textContent = astro;
        if (nameEl) nameEl.textContent = " · " + (names[astro] || "Amara Okafor");
        if (dayEl && day) dayEl.textContent = "Day " + day + " · Offline · On-device";
      })();
