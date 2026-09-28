import { S } from './session.7a9a6abf.js';
import { $, money } from './util.03612f15.js';
import { trainEmps, trainingInitCost, trainingOngoingMonthly } from './cost-engine.33998d54.js';
/* training.js — generated module. Source of truth: js/ (edit here, then run tools/build-assets.mjs). */

  function trainMathHTML(inp){
    const emps = trainEmps(inp);
    const staffCost = emps * S.TRAIN.hrsPerEmp * S.TRAIN.wage;
    const trainerCost = S.TRAIN.trainerMode === "tech" ? S.TRAIN.trainerHrs * S.techRate : 0;
    const ongMo = trainingOngoingMonthly(inp);
    const hiresYr = Math.round(emps * S.TRAIN.turnover * 10) / 10;
    return "<div>Go-live staff time: " + emps + " × " + S.TRAIN.hrsPerEmp + " hrs × $" + S.TRAIN.wage + "/hr = <strong>" + money(staffCost) + "</strong> one-time</div>" +
      "<div>Trainer: " + (S.TRAIN.trainerMode === "tech"
        ? S.TRAIN.trainerHrs + " hrs × " + money(S.techRate) + "/hr = <strong>" + money(trainerCost) + "</strong> one-time"
        : "you do it — <strong>$0</strong> fee, but it's your hours") + "</div>" +
      "<div>New hires: " + emps + " × " + Math.round(S.TRAIN.turnover * 100) + "% ≈ <strong>" + hiresYr + " hires/yr</strong> × " +
      S.TRAIN.hireHrs + " hrs × $" + S.TRAIN.wage + "/hr = <strong>" + money(ongMo) + "/mo</strong> ongoing</div>" +
      '<div class="detail">At ' + Math.round(S.TRAIN.turnover * 100) + "% turnover, training isn't a one-time cost — it's a subscription to your own hiring. " +
      "Cut turnover and this line shrinks; ignore it and you pay it forever.</div>";
  }

  function updateTrainMath(){
    const m = $("train-math"); if(m) m.innerHTML = trainMathHTML(S.getInputs());
    const i = $("train-init-amt"), o = $("train-ong-amt");
    if(i) i.textContent = money(trainingInitCost(S.getInputs()));
    if(o) o.textContent = money(trainingOngoingMonthly(S.getInputs())) + "/mo";
  }

  function renderTrainingTier(list){
    ["tr-initial","tr-ongoing"].forEach(id => { if(!S.state[id]) S.state[id] = {checked:true, optIdx:0, qty:0}; });
    const stI = S.state["tr-initial"], stO = S.state["tr-ongoing"];
    const inp = S.getInputs();
    const emps = trainEmps(inp);
    let html = '<div class="train-it-note">🖥️ <strong>Why training sits in your IT budget:</strong> a new POS/back-office system only pays off if your staff can run it. These are the paid hours to get them there — and it\'s the line most installs quietly blow past.</div><div class="train-tracks">';
    S.DATA.training.tracks.forEach(t => { html += '<div class="train-track"><h4>' + t.t + "</h4><p>" + t.d + "</p></div>"; });
    html += '</div><div class="train-warn">' + S.DATA.training.warn + "</div>";
    html += '<div class="train-cost"><h4>💵 What the training actually costs — adjust it to your shop</h4>' +
      '<label class="trow"><span>Staff wage</span><input type="range" id="tr-wage" min="16" max="40" step="0.5" value="' + S.TRAIN.wage + '" aria-label="Staff hourly wage"><span><b>$' + S.TRAIN.wage + '/hr</b> <em>(Ontario minimum $17.95 from Oct 1, 2026 — ontario.ca)</em></span></label>' +
      '<label class="trow"><span>Go-live training per employee</span><input type="range" id="tr-hrs" min="2" max="16" step="1" value="' + S.TRAIN.hrsPerEmp + '" aria-label="Go-live training hours per employee"><span><b>' + S.TRAIN.hrsPerEmp + ' hrs</b> <em>(est. — bigger systems need more)</em></span></label>' +
      '<label class="trow"><span>Employees to train</span><input type="number" id="tr-emps" min="0" max="500" step="1" value="' + emps + '" aria-label="Employees to train"><span><em>(follows your employee count until you change it)</em></span></label>' +
      '<div class="trow"><span>Who runs the training?</span><span class="trainer-pick">' +
      '<label><input type="radio" name="tr-trainer" value="self"' + (S.TRAIN.trainerMode === "self" ? " checked" : "") + '> We do it — $0 trainer fee</label>' +
      '<label><input type="radio" name="tr-trainer" value="tech"' + (S.TRAIN.trainerMode === "tech" ? " checked" : "") + '> Installer/tech does it — <input type="number" id="tr-trainerhrs" min="1" max="40" step="1" value="' + S.TRAIN.trainerHrs + '" aria-label="Trainer hours"> hrs × tech rate (' + money(S.techRate) + '/hr)</label>' +
      '</span></div>' +
      '<label class="trow"><span>Annual staff turnover</span><input type="range" id="tr-turn" min="0" max="200" step="5" value="' + Math.round(S.TRAIN.turnover * 100) + '" aria-label="Annual staff turnover percent"><span><b>' + Math.round(S.TRAIN.turnover * 100) + '%/yr</b> <em>(hospitality avg ~73–76%/yr, US BLS via Escoffier/7shifts — set yours)</em></span></label>' +
      '<label class="trow"><span>Training per new hire</span><input type="range" id="tr-hirehrs" min="2" max="12" step="1" value="' + S.TRAIN.hireHrs + '" aria-label="Training hours per new hire"><span><b>' + S.TRAIN.hireHrs + ' hrs</b> <em>(est. — usually shorter than go-live)</em></span></label>' +
      '<div class="train-math" id="train-math">' + trainMathHTML(inp) + "</div></div>";
    const mats = S.DATA.training.mats[S.sector] || S.DATA.training.mats.retail;
    const sheet = (title, emoji, lines) => {
      let s = '<details class="train-sheet"><summary>' + emoji + " <strong>" + title + "</strong></summary><ol>";
      lines.forEach(l => { s += "<li>" + l + "</li>"; });
      return s + "</ol></details>";
    };
    html += '<div class="train-mats"><h4>📚 Starter materials — print these, hand them out</h4>' +
      sheet("Quick-start checklist — everyone's first week", "📋", mats.checklist) +
      sheet("Cashier cheat sheet", "🧾", mats.cashier) +
      sheet("Kitchen / back-of-house cheat sheet", "🍳", mats.kitchen) +
      sheet("Manager cheat sheet", "🧑‍💼", mats.manager) + "</div>";
    html += '<div class="train-items">' +
      '<label class="sim-check"><input type="checkbox" data-train="tr-initial"' + (stI.checked ? " checked" : "") + '> <span><strong>Include go-live training</strong> — <strong id="train-init-amt">' + money(trainingInitCost(inp)) + "</strong> one-time, paid at install</span></label>" +
      '<label class="sim-check"><input type="checkbox" data-train="tr-ongoing"' + (stO.checked ? " checked" : "") + '> <span><strong>Include new-hire training</strong> — <strong id="train-ong-amt">' + money(trainingOngoingMonthly(inp)) + "/mo</strong> ongoing (turnover never sleeps)</span></label>" +
      "</div>";
    list.innerHTML = html;
    const live = (id, fn, fmt) => {
      const el = $(id); if(!el) return;
      el.addEventListener("input", () => {
        fn(+el.value, el);
        const b = el.closest(".trow").querySelector("b");
        if(b && fmt) b.textContent = fmt(+el.value);
        updateTrainMath(); S.recalc();
      });
      el.addEventListener("change", () => S.renderCatalog());
    };
    live("tr-wage", v => { S.TRAIN.wage = v; }, v => "$" + v + "/hr");
    live("tr-hrs", v => { S.TRAIN.hrsPerEmp = v; }, v => v + " hrs");
    live("tr-turn", v => { S.TRAIN.turnover = v / 100; }, v => v + "%/yr");
    live("tr-hirehrs", v => { S.TRAIN.hireHrs = v; }, v => v + " hrs");
    const te = $("tr-emps");
    if(te){
      // Live recalc on every keystroke (not just on blur/change) — the computed
      // training text must never lag behind what the user typed.
      te.addEventListener("input", () => {
        S.TRAIN.emps = Math.max(0, +te.value || 0); S.TRAIN.empsTouched = true;
        updateTrainMath(); S.recalc();
      });
      te.addEventListener("change", () => { S.TRAIN.emps = Math.max(0, +te.value || 0); S.TRAIN.empsTouched = true; S.renderCatalog(); });
    }
    document.querySelectorAll('input[name="tr-trainer"]').forEach(r => {
      r.addEventListener("change", () => { S.TRAIN.trainerMode = r.value; S.renderCatalog(); });
    });
    const th = $("tr-trainerhrs");
    if(th) th.addEventListener("change", () => { S.TRAIN.trainerHrs = Math.max(1, +th.value || 4); S.renderCatalog(); });
    document.querySelectorAll('input[data-train]').forEach(cb => {
      cb.addEventListener("change", () => { S.state[cb.dataset.train].checked = cb.checked; S.renderCatalog(); });
    });
  }

  /* ---- One-click typical setups: answers to the 3 questions + business basics.
     The auto-build derives everything else. A starting point, not a recommendation. ---- */

export { trainMathHTML, updateTrainMath, renderTrainingTier };
