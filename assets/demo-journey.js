(() => {
  "use strict";

  const batchCount = 3;
  const root = new URL("../", document.currentScript.src).pathname;
  const storageKey = `nafis360:demo-progress:v1:${root}`;
  const registry = window.NafisSchoolRegistry;
  const enrolled = new URL(document.URL ?? document.currentScript.src).searchParams.get("student") === "1";
  const initial = enrolled ? registry?.selectedStudent() : null;
  const selection = initial ? { code: initial.school.code, id: initial.student.id } : null;
  const learner = () => {
    const current = selection && registry.selectedStudent();
    return current?.school.code === selection?.code && current?.student.id === selection?.id ? current : null;
  };
  const emptyProgress = { pre: false, batches: 0, post: false };

  function progress() {
    if (enrolled) {
      const current = learner();
      return current ? registry.progress(current.student) : { ...emptyProgress };
    }
    try {
      const data = JSON.parse(window.localStorage.getItem(storageKey));
      if (data?.pre !== true) return { ...emptyProgress };
      const batches = Number.isInteger(data.batches)
        ? Math.max(0, Math.min(batchCount, data.batches))
        : 0;
      return { pre: true, batches, post: batches === batchCount && data.post === true };
    } catch {
      return { ...emptyProgress };
    }
  }

  function canOpen(stage, state = progress()) {
    if (enrolled && !learner()) return false;
    if (stage === "training") return state.pre;
    if (stage === "post") return state.batches === batchCount;
    return stage === "pre";
  }

  function complete(stage, batchIndex, result) {
    if (enrolled) {
      if (!learner()) return false;
      return registry.recordResult(selection, stage, batchIndex, result);
    }
    const state = progress();
    if (!canOpen(stage, state)) return false;

    if (stage === "pre") state.pre = true;
    if (stage === "training") {
      if (!Number.isInteger(batchIndex) || batchIndex < 0 ||
          batchIndex >= batchCount || batchIndex > state.batches) return false;
      state.batches = Math.max(state.batches, batchIndex + 1);
    }
    if (stage === "post") state.post = true;

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  window.NafisDemoJourney = { batchCount, progress, canOpen, complete, enrolled, learner };

  const stageLinks = document.querySelectorAll("[data-journey-stage]");
  function updateLinks() {
    const state = progress();
    for (const link of stageLinks) {
      const unlocked = canOpen(link.dataset.journeyStage, state);
      if (unlocked) {
        link.setAttribute("href", link.dataset.path);
        link.removeAttribute("aria-disabled");
      } else {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
      }
      link.textContent = unlocked ? link.dataset.openLabel : link.dataset.lockedLabel;
    }
  }

  if (stageLinks.length) {
    updateLinks();
    window.addEventListener("pageshow", updateLinks);
    window.addEventListener("storage", updateLinks);
  }
})();
