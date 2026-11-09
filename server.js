const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");

const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
const listFile = path.join(dataDir, "accounts.json");
const sessions = new Map();
const sessionAge = 8 * 60 * 60 * 1000;

fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(listFile)) fs.writeFileSync(listFile, "[]\n");

const read = file => JSON.parse(fs.readFileSync(file, "utf8"));

function save(file, value) {
   fs.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2) + "\n");
   fs.renameSync(file + ".tmp", file);
}

function hashPassword(password) {
   const salt = randomBytes(16).toString("hex");
   return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}

function checkPassword(password, stored) {
   const [salt, hash] = stored.split(":");
   return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, "hex"));
}

function json(res, status, value) {
   res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
   });
   res.end(JSON.stringify(value));
}

async function body(req) {
   if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
      throw new Error("Expected JSON");
   }
   let input = "";
   for await (const chunk of req) {
      input += chunk;
      if (input.length > 16000) throw new Error("Request too large");
   }
   return JSON.parse(input);
}

const pages = {
   "/": ["index.html", "text/html"],
   "/create": ["create.html", "text/html"],
   "/form": ["form.html", "text/html"],
   "/records": ["records.html", "text/html"],
   "/style.css": ["style.css", "text/css"],
   "/app.js": ["app.js", "text/javascript"]
};

const server = http.createServer(async (req, res) => {
   const route = req.url.split("?")[0];
   const token = /(?:^|;\s*)session=([a-f0-9]+)/.exec(req.headers.cookie || "")?.[1];
   const session = sessions.get(token);
   if (session && session.expires <= Date.now()) sessions.delete(token);
   const signedIn = sessions.get(token);
   const secure = process.env.RENDER === "true" ? "; Secure" : "";
   const cookie = "; Path=/; HttpOnly; SameSite=Lax" + secure;

   try {
      if (req.method === "GET" && Object.hasOwn(pages, route)) {
         if (["/form", "/records"].includes(route) && !signedIn) {
            res.writeHead(302, { Location: "/" });
            return res.end();
         }
         const [file, type] = pages[route];
         const contents = fs.readFileSync(path.join(__dirname, file));
         res.writeHead(200, {
            "Content-Type": type + "; charset=utf-8",
            "Cache-Control": "no-store"
         });
         return res.end(contents);
      }

      if (req.method === "POST" && ["/api/create", "/api/login"].includes(route)) {
         let input;
         try { input = await body(req); }
         catch { return json(res, 400, { error: "Invalid request." }); }

         const username = typeof input?.username === "string" ? input.username.trim() : "";
         const password = typeof input?.password === "string" ? input.password : "";
         if (!username || !password.trim() || username.length > 60 || password.length > 200) {
            return json(res, 400, { error: "Enter a username and password within the field limits." });
         }

         const accounts = read(listFile);
         const account = accounts.find(entry => entry.username === username);

         if (route === "/api/create") {
            if (account) return json(res, 409, { error: "That username is already taken." });
            const id = randomBytes(8).toString("hex");
            const accountFile = "account-" + id + ".json";
            const passwordHash = hashPassword(password);
            fs.writeFileSync(path.join(dataDir, accountFile),
               JSON.stringify({ id, username, password: passwordHash, answers: null }, null, 2),
               { flag: "wx" });
            accounts.push({ id, username, password: passwordHash, accountFile });
            save(listFile, accounts);
            return json(res, 201, { message: "Account created. You can now log in." });
         }

         if (!account || !checkPassword(password, account.password)) {
            return json(res, 401, { error: "Incorrect username or password." });
         }

         sessions.delete(token);
         const newToken = randomBytes(32).toString("hex");
         sessions.set(newToken, { accountFile: account.accountFile, expires: Date.now() + sessionAge });
         res.setHeader("Set-Cookie", "session=" + newToken + cookie + "; Max-Age=28800");
         return json(res, 200, { message: "Logged in." });
      }

      if (!signedIn) return json(res, 401, { error: "Please log in first." });

      if (route === "/api/logout" && req.method === "POST") {
         sessions.delete(token);
         res.setHeader("Set-Cookie", "session=" + cookie + "; Max-Age=0");
         return json(res, 200, { message: "Logged out." });
      }

      if (route === "/api/form") {
         const file = path.join(dataDir, signedIn.accountFile);
         if (req.method === "GET") {
            return json(res, 200, { answers: read(file).answers });
         }

         if (req.method === "POST") {
            let input;
            try { input = await body(req); }
            catch { return json(res, 400, { error: "Invalid request." }); }

            if (!input || typeof input.place !== "string" || input.place.length > 120 ||
                !["", "Morning", "Afternoon", "Evening"].includes(input.time) ||
                !["", "Alone", "With a group"].includes(input.preference) ||
                typeof input.music !== "boolean" ||
                typeof input.notes !== "string" || input.notes.length > 1000) {
               return json(res, 400, { error: "Check your survey answers and try again." });
            }

            const account = read(file);
            account.answers = {
               place: input.place.trim(),
               time: input.time,
               preference: input.preference,
               music: input.music,
               notes: input.notes.trim()
            };
            save(file, account);
            return json(res, 200, { message: "Survey saved." });
         }
      }

      if (route === "/api/records" && req.method === "GET") {
         const records = read(listFile).map(entry => {
            const account = read(path.join(dataDir, entry.accountFile));
            return { id: account.id, answers: account.answers };
         });
         return json(res, 200, { records });
      }

      return json(res, 404, { error: "Not found." });
   } catch (error) {
      console.error(error.message);
      return json(res, 500, { error: "The server could not complete the request." });
   }
});

server.listen(process.env.PORT || 3000, "0.0.0.0");
