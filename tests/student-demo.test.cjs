const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function element() {
  const handlers = new Map();
  const classes = new Set();
  return {
    children: [],
    textContent: '',
    hidden: false,
    classList: {
      toggle(name, active) { if (active) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    addEventListener(event, handler) { handlers.set(event, handler); },
    emit(event) { return handlers.get(event)(); },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    querySelectorAll() { return []; },
    focus() {}
  };
}

function openDemo(mode, data = new Map(), rootPath = '/demo/', session = new Map(), enrolled = false) {
  const page = read(`${mode}/index.html`);
  const elements = new Map(Array.from(page.matchAll(/\bid="([^"]+)"/g),
    ([, id]) => [id, element()]));
  const get = (id) => elements.get(id);
  const document = {
    URL: `https://example.test${rootPath}${mode}/${enrolled ? "?student=1" : ""}`,
    currentScript: { src: `https://example.test${rootPath}assets/demo-journey.js` },
    querySelectorAll: () => [],
    body: { dataset: { mode: page.match(/<body data-mode="([^"]+)"/)?.[1] } },
    getElementById: get,
    createElement: element,
    createTextNode: (text) => text
  };
  const window = {
    addEventListener() {},
    navigator: {},
    crypto: {
      getRandomValues: (bytes) => bytes.fill(Math.floor(Math.random() * 256)),
      randomUUID: require("node:crypto").randomUUID
    },
    sessionStorage: {
      getItem: key => session.get(key) ?? null,
      setItem: (key, value) => session.set(key, value),
      removeItem: key => session.delete(key)
    },
    localStorage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value)
    }
  };
  const context = vm.createContext({ document, window, URL });
  for (const [, script] of page.matchAll(/<script src="\.\.\/([^"]+)"/g)) {
    vm.runInContext(read(script), context);
  }
  const select = (index) => get('options').children[index].children[0].emit('change');
  const click = (id) => get(id).emit('click');
  return {
    get, select, click,
    batchButton: (index) => get('batches').children[index].children[2],
    journey: window.NafisDemoJourney,
    registry: window.NafisSchoolRegistry,
    bank: window.NAFIS_DEMO_QUESTIONS
  };
}

test('home links resolve and each demo loads shared assets', () => {
  const home = read('index.html');
  for (const stage of ['pre', 'training', 'post']) {
    assert.ok(home.includes(`${stage === "pre" ? "href" : "data-path"}="./${stage}/"`));
    const page = read(`${stage}/index.html`);
    for (const file of ['demo.css', 'demo-journey.js', 'questions-demo.js', 'pre-demo.js']) {
      assert.ok(page.includes(`../assets/${file}`));
      assert.ok(read(`assets/${file}`).length > 0);
    }
  }
});

test('pre demo has 30 valid questions and requires every answer before scoring', async () => {
  const { get, select, click, bank, journey } = openDemo('pre');
  click('start');
  const counts = new Map();
  for (const question of bank) {
    assert.equal(question.options.length, 4);
    assert.ok(Number.isInteger(question.correct) && question.correct >= 0 && question.correct < 4);
    counts.set(question.domain, (counts.get(question.domain) || 0) + 1);
  }
  assert.deepEqual([...counts.values()], [10, 10, 10]);
  assert.equal(new Set(bank.map((question) => question.id)).size, 30);

  for (let index = 0; index < 30; index++) await click('next');
  assert.match(get('status').textContent, /يرجى إكمال/);
  assert.equal(get('question').textContent, bank[0].text);
  assert.equal(journey.canOpen('training'), false);

  select(bank[0].correct);
  await click('next');
  click('previous');
  assert.equal(get('options').children[bank[0].correct].children[0].checked, true);
  assert.equal(get('status').textContent, '');
  for (const [index, question] of bank.entries()) {
    select(index === 0 ? (question.correct + 1) % 4 : question.correct);
    await click('next');
  }
  assert.equal(get('score').textContent, '29 من 30');
  assert.equal(get('domains').children.length, 3);
  assert.equal(journey.canOpen('training'), true);
  assert.equal(get('onward').hidden, false);
  click('restart');
  assert.equal(get('progress').value, 0);
});

test('direct routes stay locked and training opens in order after completing each batch', async () => {
  const storage = new Map();
  const pre = openDemo('pre', storage);
  const locked = openDemo('training', storage);
  assert.equal(locked.get('welcome').classList.contains('hidden'), true);
  assert.equal(locked.get('locked').classList.contains('hidden'), false);
  assert.equal(pre.journey.complete('training', 0), false);
  assert.equal(pre.journey.complete('post'), false);

  pre.click('start');
  for (const question of pre.bank) {
    pre.select(question.correct);
    await pre.click('next');
  }
  const isolated = openDemo('training', storage, '/another-project/');
  assert.equal(isolated.get('locked').classList.contains('hidden'), false);

  const training = openDemo('training', storage);
  assert.deepEqual([0, 1, 2].map(index => training.batchButton(index).disabled), [false, true, true]);
  assert.equal(training.journey.complete('training', 2), false);
  const earlyPost = openDemo('post', storage);
  earlyPost.click('start');
  assert.equal(earlyPost.get('locked').classList.contains('hidden'), false);
  assert.equal(earlyPost.get('quiz').classList.contains('hidden'), true);

  for (const index of [0, 1, 2]) {
    training.batchButton(index).emit('click');
    const questions = training.bank.slice(index * 10, (index + 1) * 10);
    if (index === 0) {
      const { correct, options } = questions[0];
      training.select((correct + 1) % 4);
      assert.ok(training.get('status').textContent.includes(options[correct]));
      for (let step = 0; step < 10; step++) await training.click('next');
      assert.match(training.get('status').textContent, /يرجى إكمال/);
      assert.equal(training.journey.progress().batches, 0);
      training.click('previous');
    }
    for (const question of questions) {
      assert.equal(training.get('question').textContent, question.text);
      training.select(question.correct);
      assert.match(training.get('status').textContent, /إجابة صحيحة/);
      await training.click('next');
    }
    assert.equal(training.get('score').textContent, '10 من 10');
    assert.equal(training.get('onward').hidden, index !== 2);
    training.click('restart');
    const reloaded = openDemo('training', storage);
    assert.equal(reloaded.journey.progress().batches, index + 1);
    assert.equal(reloaded.batchButton(index).textContent, `إعادة الدفعة ${index + 1}`);
  }

  const post = openDemo('post', storage);
  post.click('start');
  const ordered = [0, 10, 20].flatMap((offset) =>
    Array.from(post.bank.slice(offset, offset + 10)).reverse());
  for (const question of ordered) {
    assert.equal(post.get('question').textContent, question.text);
    post.select(question.correct);
    assert.equal(post.get('status').textContent, '');
    await post.click('next');
  }
  assert.equal(post.get('score').textContent, '30 من 30');
  assert.equal(openDemo('post', storage).journey.progress().post, true);
});

test("registered school roster and quiz pages share the same saved results across the full journey", async () => {
  const storage = new Map(), session = new Map();
  const open = mode => openDemo(mode, storage, "/demo/", session, true);
  const registry = open("pre").registry;
  const unauthenticated = open("pre");
  assert.equal(unauthenticated.journey.canOpen("pre"), false);

  const school = await registry.save({ name: "مدرسة اختبار", office: "إدارة اختبار", status: "active" });
  const code = await registry.issueTeacherCode(school.code);
  assert.throws(() => registry.authenticateTeacher(school.code, "XXXXXXXX"), /invalid-teacher/);
  const one = registry.previewNames(school, "طالبة أولى");
  await registry.addStudents(school.code, code, "طالبة أولى", one.additions);
  const bulk = "طالبة أولى\r\nطالبة ثانية\nطالبة ثانية\nس\nطالبة ثالثة";
  const preview = registry.previewNames(registry.school(school.code), bulk);
  assert.equal(preview.additions.length, 2);
  assert.equal(preview.duplicates, 2);
  assert.equal(preview.invalid, 1);
  await registry.addStudents(school.code, code, bulk, preview.additions);
  assert.equal(registry.students(registry.school(school.code)).length, 3);
  await assert.rejects(registry.addStudents(school.code, code, bulk, preview.additions), /roster-changed/);
  const [first, second, third] = registry.students(registry.school(school.code));
  registry.selectStudent(school.code, first.id);

  assert.equal(open("training").journey.canOpen("training"), false);
  const pre = open("pre");
  pre.click("start");
  for (const question of pre.bank) {
    pre.select(question.correct);
    await pre.click("next");
  }
  assert.equal(open("training").journey.canOpen("training"), true);
  assert.equal(open("post").journey.canOpen("post"), false);

  const training = open("training");
  for (const index of [0, 1, 2]) {
    assert.equal(training.batchButton(index).disabled, false);
    if (index < 2) assert.equal(training.batchButton(index + 1).disabled, true);
    training.batchButton(index).emit("click");
    for (const question of training.bank.slice(index * 10, (index + 1) * 10)) {
      training.select(question.correct);
      await training.click("next");
    }
    training.click("restart");
  }
  const post = open("post");
  assert.equal(post.journey.canOpen("post"), true);
  post.click("start");
  const ordered = [0, 10, 20].flatMap(offset =>
    Array.from(post.bank.slice(offset, offset + 10)).reverse());
  for (const question of ordered) {
    post.select(question.correct);
    await post.click("next");
  }

  const updated = registry.students(registry.authenticateTeacher(school.code, code));
  assert.equal(updated[0].results.pre.correct, 30);
  assert.equal(updated[0].results.training.length, 3);
  assert.equal(updated[0].results.post.correct, 30);
  assert.equal(updated[0].results.post.domains.length, 3);
  assert.equal(updated[1].results, undefined);

  registry.selectStudent(school.code, second.id);
  assert.equal(open("training").journey.canOpen("training"), false);
  assert.equal(post.journey.learner(), null);
  await registry.updateStudent(school.code, code, second.id, "طالبة ثانية معدلة");
  await registry.updateStudent(school.code, code, third.id, null);
  assert.equal(registry.students(registry.school(school.code)).length, 2);
  assert.equal(registry.students(registry.school(school.code))[1].name, "طالبة ثانية معدلة");
  await registry.toggle(school.code);
  assert.equal(registry.selectedStudent(), null);
});
