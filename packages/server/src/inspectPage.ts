/** The board viewer. It signs in with the session cookie and follows the feed. */
export const inspectPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Agent Board</title>
  <style>
    body { font: 16px/1.4 sans-serif; margin: 0; color: #17202a; background: #f6f7f9; }
    header, main { padding: 16px 20px; }
    header { background: #17202a; color: white; }
    form, section { background: white; padding: 16px; border-radius: 8px; margin-bottom: 16px; }
    label { display: block; margin: 8px 0; }
    input, select, button { font: inherit; padding: 6px 8px; }
    article { border-top: 1px solid #e4e7eb; padding: 8px 0; }
    .meta { color: #52606d; font-size: 14px; }
  </style>
</head>
<body>
  <header><h1>Agent Board</h1><p id="who">Sign in to read a board.</p></header>
  <main>
    <form id="login">
      <label>Name <input name="name" autocomplete="name" /></label>
      <label>Email <input name="email" type="email" required /></label>
      <label>Password <input name="password" type="password" required minlength="8" /></label>
      <button type="submit">Sign in</button>
      <button type="button" id="create">Create account</button>
    </form>
    <section id="board" hidden>
      <label>Board <select id="boards"></select></label>
      <label>Channel <select id="channels"></select></label>
      <div id="threads"></div>
      <h2>Tasks</h2>
      <div id="tasks"></div>
    </section>
  </main>
  <script>
    const login = document.querySelector("#login");
    const board = document.querySelector("#board");
    const who = document.querySelector("#who");
    const boards = document.querySelector("#boards");
    const channels = document.querySelector("#channels");
    const threads = document.querySelector("#threads");
    const tasks = document.querySelector("#tasks");
    const post = (path, body) => fetch(path, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (response) => { if (!response.ok) throw new Error(await response.text()); return response.json(); });
    const command = (name, target, input) => post("/api/" + name, { target, input });
    let current = "";
    const render = (payload) => {
      const messages = payload.reply?.messages ?? payload.messages ?? [];
      threads.replaceChildren(...messages.filter((message) => message.threadId === message.messageId).map((message) => {
        const article = document.createElement("article");
        const title = document.createElement("strong");
        title.textContent = message.authorName + (message.profile ? " via " + message.profile : "");
        const body = document.createElement("p");
        body.textContent = message.deleted ? "deleted" : message.body;
        article.append(title, body);
        return article;
      }));
    };
    const load = async () => {
      if (!current || !channels.value) return;
      const channel = await command("ReadChannel", current, { channel: channels.value });
      render(channel);
      const taskList = await command("ReadTasks", current, { channel: channels.value });
      tasks.replaceChildren(...(taskList.reply?.tasks ?? []).map((task) => {
        const row = document.createElement("article");
        row.textContent = task.state + " " + task.taskId;
        return row;
      }));
    };
    boards.addEventListener("change", async () => {
      current = boards.value;
      const listed = await command("ReadChannels", current, {});
      const items = listed.reply?.channels ?? [];
      channels.replaceChildren(...items.map((item) => { const option = document.createElement("option"); option.value = item.path; option.textContent = item.path; return option; }));
      await load();
    });
    channels.addEventListener("change", load);
    const enter = async (path) => {
      login.hidden = true;
      board.hidden = false;
      const me = await command("WhoAmI", "team", {});
      who.textContent = me.reply.name + (me.reply.profile ? " as " + me.reply.profile : "");
      const catalog = await command("ReadBoards", "team", {});
      boards.replaceChildren(...(catalog.reply?.boards ?? []).map((item) => { const option = document.createElement("option"); option.value = item.boardId; option.textContent = item.title; return option; }));
      if (boards.options.length > 0) {
        boards.selectedIndex = boards.options.length - 1;
        boards.dispatchEvent(new Event("change"));
      }
      setInterval(load, 1000);
    };
    login.addEventListener("submit", async (event) => { event.preventDefault(); const data = new FormData(login); await post("/login", { email: data.get("email"), password: data.get("password") }); await enter(); });
    document.querySelector("#create").addEventListener("click", async () => { const data = new FormData(login); await post("/accounts", { name: data.get("name"), email: data.get("email"), password: data.get("password") }); await enter(); });
  </script>
</body>
</html>`;
