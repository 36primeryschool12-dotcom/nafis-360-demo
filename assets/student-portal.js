(() => {
  "use strict";
  const store = window.NafisSchoolRegistry;
  const $ = id => document.getElementById(id);
  let schoolCode = null;
  function render() {
    const selected = store.selectedStudent();
    $("student-workspace").hidden = !selected;
    if (!selected) return;

    const { school, student } = selected;
    const progress = store.progress(student);
    $("student-title").textContent = `${student.name} · ${school.name}`;
    const list = $("student-stages");
    list.replaceChildren();
    const grade = result => `${result.correct} من ${result.total}`;
    for (const [stage, title, status, unlocked] of [
      ["pre", "القياس القبلي", progress.pre ? grade(student.results.pre) : "متاح", true],
      ["training", "دفعات التدريب", progress.pre ? `${progress.batches} من ${store.batchCount}` : "مقفل حتى إكمال القبلي", progress.pre],
      ["post", "القياس البعدي", progress.post ? grade(student.results.post) : progress.batches === store.batchCount ? "متاح" : "مقفل حتى إكمال التدريب", progress.batches === store.batchCount]
    ]) {
      const card = document.createElement("article");
      card.className = "step";
      const heading = document.createElement("strong");
      heading.textContent = title;
      const label = document.createElement("span");
      label.textContent = status;
      card.append(heading, label);
      if (unlocked) {
        const link = document.createElement("a");
        link.className = "stage-link";
        link.href = `../${stage}/?student=1`;
        link.textContent = `فتح ${title}`;
        card.append(document.createElement("br"), link);
      }
      list.append(card);
    }
  }

  $("student-school-code").addEventListener("input", () => {
    schoolCode = null;
    $("student-form").hidden = true;
  });
  $("school-form").addEventListener("submit", event => {
    event.preventDefault();
    schoolCode = null;
    $("student-form").hidden = true;
    try {
      const school = store.school($("student-school-code").value);
      const roster = store.students(school);
      if (!roster.length) {
        $("student-status").textContent = "أضيفي طالبة إلى هذه المدرسة من لوحة المعلمة أولًا.";
        return;
      }
      schoolCode = school.code;
      const select = $("student-name");
      const placeholder = new Option("اختاري اسمكِ", "", true, true);
      placeholder.disabled = true;
      select.replaceChildren(placeholder, ...roster.map(student => new Option(student.name, student.id)));
      $("student-form").hidden = false;
      $("student-status").textContent = `تم العثور على المدرسة: ${school.name}`;
      select.focus();
    } catch {
      $("student-status").textContent = "رمز المدرسة غير صحيح، أو المدرسة غير نشطة.";
    }
  });
  $("student-form").addEventListener("submit", event => {
    event.preventDefault();
    try {
      store.selectStudent(schoolCode, $("student-name").value);
      $("student-status").textContent = "تم فتح الرحلة.";
      render();
    } catch {
      $("student-status").textContent = "تعذر فتح الرحلة. راجعي رمز المدرسة واختيار الاسم.";
    }
  });
  $("student-logout").addEventListener("click", () => {
    store.clearStudent();
    $("student-status").textContent = "";
    render();
    $("student-school-code").focus();
  });
  window.addEventListener("pageshow", render);
  window.addEventListener("storage", event => { if (event.key === store.key || event.key === null) render(); });
  render();
})();
