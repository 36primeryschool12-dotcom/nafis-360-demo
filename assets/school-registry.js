(() => {
  "use strict";

  const key = `nafis360:new-schools:v1:${new URL("../", document.currentScript.src).pathname}`;
  const studentSession = key + ":student";
  const batchCount = 3;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codePattern = new RegExp(`^[${alphabet}]{8}$`);
  const field = value => typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  const identity = value => field(value).normalize("NFKC").toLocaleLowerCase("ar");
  const sameSchool = (a, b) => identity(a.name) === identity(b.name) &&
    identity(a.office) === identity(b.office);
  const validStatus = status => status === "active" || status === "inactive";

  function read() {
    const records = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(records) || records.some(record =>
      !record || typeof record.code !== "string" || !codePattern.test(record.code) ||
      !field(record.name) || !field(record.office) || !validStatus(record.status)
    ) || new Set(records.map(record => record.code)).size !== records.length) {
      throw new Error("invalid-storage");
    }
    return records;
  }

  function newCode(records) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const bytes = window.crypto.getRandomValues(new Uint8Array(8));
      const code = Array.from(bytes, value => alphabet[value % alphabet.length]).join("");
      if (!records.some(record => record.code === code)) return code;
    }
    throw new Error("code-generation");
  }

  async function change(update) {
    const commit = () => {
      const records = read();
      const result = update(records);
      window.localStorage.setItem(key, JSON.stringify(records));
      return result;
    };
    return window.navigator.locks
      ? window.navigator.locks.request(key, commit)
      : commit();
  }

  function save(input, code) {
    const school = { name: field(input.name), office: field(input.office), status: input.status };
    if (!school.name || !school.office || school.name.length > 120 ||
        school.office.length > 120 || !validStatus(school.status)) {
      throw new Error("invalid-school");
    }
    return change(records => {
      const index = code ? records.findIndex(record => record.code === code) : -1;
      if (code && index < 0) throw new Error("missing-school");
      if (records.some((record, position) => position !== index && sameSchool(record, school))) {
        throw new Error("duplicate-school");
      }

      const result = index < 0
        ? { ...school, code: newCode(records), teacherCode: newTeacherCode(), students: [] }
        : { ...records[index], ...school };
      if (index < 0) records.push(result);
      else records[index] = result;
      return result;
    });
  }

  function toggle(code) {
    return change(records => {
      const school = records.find(record => record.code === code);
      if (!school) throw new Error("missing-school");
      school.status = school.status === "active" ? "inactive" : "active";
      return school;
    });
  }

  function newTeacherCode() {
    const bytes = window.crypto.getRandomValues(new Uint8Array(8));
    return Array.from(bytes, value => alphabet[value % alphabet.length]).join("");
  }

  function findSchool(records, code) {
    const school = records.find(record => record.code === field(code).toUpperCase());
    if (!school) throw new Error("missing-school");
    return school;
  }

  function activeSchool(records, code) {
    const school = findSchool(records, code);
    if (school.status !== "active") throw new Error("inactive-school");
    return school;
  }

  function teacherSchool(records, code, teacherCode) {
    const school = activeSchool(records, code);
    if (!school.teacherCode || school.teacherCode !== field(teacherCode).toUpperCase()) {
      throw new Error("invalid-teacher");
    }
    return school;
  }

  const allStudents = school => Array.isArray(school.students) ? school.students : [];
  const students = school => allStudents(school).filter(student => !student.archived);

  function issueTeacherCode(code) {
    return change(records => {
      const school = findSchool(records, code);
      school.teacherCode ||= newTeacherCode();
      return school.teacherCode;
    });
  }

  function previewNames(school, input) {
    const seen = new Set(students(school).map(student => identity(student.name)));
    const additions = [];
    let duplicates = 0;
    let invalid = 0;
    for (const line of input.split(/\r\n?|\n/u)) {
      const name = field(line);
      if (!name) continue;
      if (name.length < 3 || name.length > 120) {
        invalid++;
      } else if (seen.has(identity(name))) {
        duplicates++;
      } else {
        seen.add(identity(name));
        additions.push(name);
      }
    }
    return { additions, duplicates, invalid };
  }

  function addStudents(code, teacherCode, input, expectedNames) {
    return change(records => {
      const school = teacherSchool(records, code, teacherCode);
      const result = previewNames(school, input);
      if (JSON.stringify(result.additions) !== JSON.stringify(expectedNames)) {
        throw new Error("roster-changed");
      }
      if (!result.additions.length) throw new Error("no-students");
      school.students = allStudents(school);
      const ids = new Set(school.students.map(student => student.id));
      for (const name of result.additions) {
        const id = window.crypto.randomUUID();
        if (ids.has(id)) throw new Error("id-generation");
        ids.add(id);
        school.students.push({ id, name });
      }
      return result;
    });
  }

  function updateStudent(code, teacherCode, id, input) {
    return change(records => {
      const school = teacherSchool(records, code, teacherCode);
      const student = students(school).find(item => item.id === id);
      if (!student) throw new Error("missing-student");
      if (input === null) {
        student.archived = true;
        return;
      }

      const name = field(input);
      if (name.length < 3 || name.length > 120) throw new Error("invalid-name");
      if (students(school).some(item => item.id !== id && identity(item.name) === identity(name))) {
        throw new Error("duplicate-student");
      }
      student.name = name;
    });
  }

  function learner(records, { code, id }) {
    const school = activeSchool(records, code);
    const student = students(school).find(item => item.id === id);
    if (!student) throw new Error("missing-student");
    return { school, student };
  }

  function selectStudent(code, id) {
    const selected = learner(read(), { code, id });
    window.sessionStorage.setItem(studentSession, JSON.stringify({ code: selected.school.code, id }));
    return selected;
  }

  function selectedStudent() {
    try {
      const data = JSON.parse(window.sessionStorage.getItem(studentSession));
      return data ? learner(read(), data) : null;
    } catch {
      return null;
    }
  }

  function progress(student) {
    const record = student.results || {};
    const batches = Array.isArray(record.training) ? Math.min(record.training.length, batchCount) : 0;
    return { pre: Boolean(record.pre), batches, post: Boolean(record.post) };
  }

  function recordResult(selection, stage, batchIndex, result) {
    if (!selection || !result || !Number.isInteger(result.correct) ||
        result.total !== (stage === "training" ? 10 : 30) ||
        result.correct < 0 || result.correct > result.total) {
      throw new Error("invalid-result");
    }
    return change(records => {
      const { student } = learner(records, selection);
      const state = progress(student);
      const saved = student.results ||= { training: [] };
      if (stage === "pre") saved.pre = result;
      else if (stage === "training" && state.pre && Number.isInteger(batchIndex) &&
               batchIndex >= 0 && batchIndex < batchCount && batchIndex <= state.batches) {
        saved.training[batchIndex] = result;
      } else if (stage === "post" && state.batches === batchCount) saved.post = result;
      else throw new Error("locked-stage");
      return true;
    });
  }

  window.NafisSchoolRegistry = {
    key, batchCount, read, save, toggle, issueTeacherCode, students, previewNames,
    addStudents, updateStudent, selectStudent, selectedStudent, progress, recordResult,
    clearStudent: () => window.sessionStorage.removeItem(studentSession),
    school: code => activeSchool(read(), code),
    authenticateTeacher: (code, teacherCode) => teacherSchool(read(), code, teacherCode)
  };
})();
