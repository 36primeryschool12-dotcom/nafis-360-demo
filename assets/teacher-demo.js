(() => {
  "use strict";

  const store = window.NafisSchoolRegistry;
  const $ = id => document.getElementById(id);
  const errors = {
    "inactive-school": "المدرسة غير نشطة.",
    "roster-changed": "تغيّرت القائمة. أعيدي معاينة الأسماء قبل الحفظ.",
    "no-students": "لا توجد أسماء جديدة صالحة للحفظ.",
    "invalid-name": "أدخلي اسمًا بين 3 و120 حرفًا.",
    "duplicate-student": "الاسم مسجل مسبقًا في المدرسة."
  };
  let credentials = null;
  let pending = null;
  let editing = null;

  const message = text => { $("teacher-status").textContent = text; };
  const explain = error => errors[error.message] || "تعذرت العملية. تحققي من الرمزين وإعدادات التخزين.";
  const school = () => store.authenticateTeacher(credentials.code, credentials.secret);
  const grade = score => score ? `${score.correct} من ${score.total}` : "غير مكتمل";
  const percent = score => 100 * score.correct / score.total;

  function resultColumns(student) {
    const results = student.results || {};
    const progress = store.progress(student);
    const gain = progress.pre && progress.post
      ? (percent(results.post) - percent(results.pre)).toLocaleString("ar-SA", { maximumFractionDigits: 1 })
      : "—";
    return [student.name, grade(results.pre), `${progress.batches} من ${store.batchCount}`, grade(results.post), gain];
  }

  function metrics(students) {
    const count = condition => students.filter(condition).length;
    const pre = count(s => store.progress(s).pre);
    const training = count(s => store.progress(s).batches === store.batchCount);
    const post = count(s => store.progress(s).post);
    const paired = students.filter(s => store.progress(s).pre && store.progress(s).post);
    const average = paired.length
      ? (paired.reduce((sum, s) => sum + percent(s.results.post) - percent(s.results.pre), 0) / paired.length)
        .toLocaleString("ar-SA", { maximumFractionDigits: 1 })
      : "—";
    return `الطالبات: ${students.length} · أكملن القبلي: ${pre} · أكملن التدريب: ${training} · أكملن البعدي: ${post} · متوسط التغير: ${average} نقطة مئوية`;
  }

  function element(tag, value) {
    const item = document.createElement(tag);
    item.textContent = value;
    return item;
  }

  function button(label, action) {
    const item = element("button", label);
    item.type = "button";
    item.className = "secondary";
    item.addEventListener("click", action);
    return item;
  }

  function logout() {
    credentials = null;
    pending = null;
    editing = null;
    $("teacher-login").hidden = false;
    $("teacher-workspace").hidden = true;
    $("teacher-form").reset();
    $("single-form").reset();
    $("bulk-form").reset();
    $("student-rows").replaceChildren();
    $("report-content").replaceChildren();
    if ($("report").open) $("report").close();
    if ($("student-edit").open) $("student-edit").close();
    clearPreview();
  }

  function render() {
    if (!credentials) return;
    let current;
    try {
      current = school();
    } catch (error) {
      logout();
      message(explain(error));
      return;
    }
    const roster = store.students(current);
    $("school-title").textContent = current.name;
    $("school-metrics").textContent = metrics(roster);
    $("group-report").disabled = $("csv-report").disabled = !roster.length;
    const body = $("student-rows");
    body.replaceChildren();
    if (!roster.length) {
      const cell = body.insertRow().insertCell();
      cell.colSpan = 6;
      cell.textContent = "لا توجد طالبات مسجلات بعد.";
      return;
    }
    for (const student of roster) {
      const row = body.insertRow();
      for (const value of resultColumns(student)) row.insertCell().textContent = value;
      row.insertCell().append(
        button("عرض التقرير", () => report(student.id)),
        button("تعديل", () => edit(student, false)),
        button("أرشفة", () => edit(student, true))
      );
    }
  }

  function clearPreview() {
    pending = null;
    $("bulk-preview").hidden = true;
    $("preview-names").replaceChildren();
  }

  $("teacher-form").addEventListener("submit", event => {
    event.preventDefault();
    try {
      const secret = $("teacher-code").value.trim();
      const current = store.authenticateTeacher($("school-code").value, secret);
      credentials = { code: current.code, secret };
      $("teacher-code").value = "";
      $("teacher-login").hidden = true;
      $("teacher-workspace").hidden = false;
      message("تم فتح لوحة المعلمة.");
      render();
    } catch (error) {
      message(explain(error));
    }
  });

  $("logout").addEventListener("click", () => { logout(); message("تم الخروج."); });

  $("single-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!credentials) return;
    const submit = event.submitter;
    if (submit?.disabled) return;
    if (submit) submit.disabled = true;
    try {
      const input = $("single-name").value;
      const preview = store.previewNames(school(), input);
      if (preview.duplicates) throw new Error("duplicate-student");
      if (preview.invalid) throw new Error("invalid-name");
      await store.addStudents(credentials.code, credentials.secret, input, preview.additions);
      $("single-form").reset();
      render();
      message("تمت إضافة الطالبة.");
    } catch (error) {
      message(explain(error));
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  $("bulk-names").addEventListener("input", clearPreview);
  $("bulk-form").addEventListener("submit", event => {
    event.preventDefault();
    clearPreview();
    try {
      const input = $("bulk-names").value;
      const preview = store.previewNames(school(), input);
      pending = { input, names: preview.additions };
      $("preview-summary").textContent = `صالحة للحفظ: ${preview.additions.length} · مكررة: ${preview.duplicates} · غير صالحة: ${preview.invalid}`;
      $("preview-names").replaceChildren(...preview.additions.map(name => element("li", name)));
      $("bulk-save").disabled = !preview.additions.length;
      $("bulk-preview").hidden = false;
    } catch (error) {
      message(explain(error));
    }
  });

  $("bulk-save").addEventListener("click", async () => {
    if (!pending || $("bulk-save").disabled) return;
    const { input, names } = pending;
    $("bulk-save").disabled = true;
    try {
      await store.addStudents(credentials.code, credentials.secret, input, names);
      $("bulk-form").reset();
      clearPreview();
      render();
      message(`تم حفظ ${names.length} اسمًا.`);
    } catch (error) {
      if (error.message === "roster-changed") clearPreview();
      message(explain(error));
    } finally {
      if (pending) $("bulk-save").disabled = false;
    }
  });

  function edit(student, archive) {
    editing = { id: student.id, archive };
    $("student-edit-title").textContent = archive ? "أرشفة الطالبة" : "تعديل اسم الطالبة";
    $("student-edit-field").hidden = archive;
    $("student-edit-name").required = !archive;
    $("student-edit-name").value = student.name;
    $("student-edit-note").textContent = archive ? `تأكيد أرشفة «${student.name}» وإخفائها من القائمة النشطة؟` : "";
    $("student-edit-save").textContent = archive ? "أرشفة الطالبة" : "حفظ التعديل";
    $("student-edit").showModal();
  }

  $("student-edit-cancel").addEventListener("click", () => $("student-edit").close());
  $("student-edit").addEventListener("close", () => { editing = null; });
  $("student-edit-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!editing || $("student-edit-save").disabled) return;
    const { id, archive } = editing;
    $("student-edit-save").disabled = true;
    try {
      await store.updateStudent(credentials.code, credentials.secret, id, archive ? null : $("student-edit-name").value);
      $("student-edit").close();
      render();
      message(archive ? "تمت أرشفة الطالبة." : "تم تعديل الاسم.");
    } catch (error) {
      $("student-edit-note").textContent = explain(error);
    } finally {
      $("student-edit-save").disabled = false;
    }
  });

  const columns = ["الطالبة", "القبلي", "التدريب", "البعدي", "التغير بالنقاط المئوية"];

  function report(id) {
    try {
      const current = school();
      const students = store.students(current).filter(student => !id || student.id === id);
      if (!students.length) return;
      $("report-title").textContent = id ? "التقرير الفردي" : "التقرير الجماعي";
      const table = document.createElement("table");
      const heading = table.createTHead().insertRow();
      for (const column of columns) heading.append(element("th", column));
      const tbody = table.createTBody();
      for (const student of students) {
        const row = tbody.insertRow();
        for (const value of resultColumns(student)) row.insertCell().textContent = value;
      }
      const reportContent = $("report-content");
      reportContent.replaceChildren(element("h3", current.name), element("p", metrics(students)), table);
      for (const [stage, title] of [["pre", "المجالات — القبلي"], ["post", "المجالات — البعدي"]]) {
        const domains = new Map();
        for (const student of students) {
          for (const item of student.results?.[stage]?.domains || []) {
            const summary = domains.get(item.name) || { correct: 0, total: 0 };
            summary.correct += item.correct;
            summary.total += item.total;
            domains.set(item.name, summary);
          }
        }
        if (!domains.size) continue;
        const list = document.createElement("ul");
        for (const [name, score] of domains) list.append(element("li", `${name}: ${grade(score)}`));
        reportContent.append(element("h3", title), list);
      }
      $("report").showModal();
    } catch (error) {
      message(explain(error));
    }
  }

  $("group-report").addEventListener("click", () => report());
  $("print-report").addEventListener("click", () => {
    document.body.classList.add("print-report");
    window.print();
  });
  window.addEventListener("afterprint", () => document.body.classList.remove("print-report"));
  $("report").addEventListener("close", () => document.body.classList.remove("print-report"));

  $("csv-report").addEventListener("click", () => {
    try {
      const current = school();
      const quote = value => `"${String(value).replace(/^([=+@-])/u, "'$1").replaceAll('"', '""')}"`;
      const csv = [columns, ...store.students(current).map(resultColumns)]
        .map(row => row.map(quote).join(",")).join("\r\n");
      const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `nafis-${current.code}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      message(explain(error));
    }
  });

  const initialCode = new URLSearchParams(window.location.search).get("school");
  if (/^[A-Z2-9]{8}$/u.test(initialCode || "")) $("school-code").value = initialCode;
  window.addEventListener("pageshow", render);
  window.addEventListener("storage", event => { if (event.key === store.key || event.key === null) render(); });
})();
