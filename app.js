const byId = id => document.getElementById(id);

async function api(url, data) {
   const options = data === undefined ? {} : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
   };

   const response = await fetch(url, options);
   const result = await response.json();

   if (!response.ok) {
      throw new Error(result.error || "The request failed.");
   }

   return result;
}

function handleSubmit(form, action, showError) {
   form.addEventListener("submit", async event => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      if (button.disabled) return;

      button.disabled = true;
      try {
         await action();
      } catch (error) {
         showError(error.message);
      } finally {
         button.disabled = false;
      }
   });
}

const loginForm = byId("login-form");

if (loginForm) {
   const username = byId("username");
   const remember = byId("remember-username");

   try {
      remember.checked = localStorage.getItem("rememberUsername") === "yes";
      if (remember.checked) {
         username.value = localStorage.getItem("savedUsername") || "";
      }
   } catch {
      // Login still works if browser storage is unavailable.
   }

   function savePreference() {
      try {
         localStorage.setItem("rememberUsername", remember.checked ? "yes" : "no");
         if (remember.checked) {
            localStorage.setItem("savedUsername", username.value.trim());
         } else {
            localStorage.removeItem("savedUsername");
         }
      } catch {
         // The remember option needs browser storage.
      }
   }

   remember.addEventListener("change", savePreference);
   username.addEventListener("input", () => {
      if (remember.checked) savePreference();
   });

   handleSubmit(loginForm, async () => {
      savePreference();
      await api("/api/login", {
         username: username.value,
         password: byId("password").value
      });
      window.location.assign("/form");
   }, message => alert(message));
}

const createForm = byId("create-form");

if (createForm) {
   const status = byId("create-status");

   handleSubmit(createForm, async () => {
      status.textContent = "";
      const username = byId("username").value.trim();
      const password = byId("password").value;

      if (!username || !password.trim()) {
         alert("Enter both a username and a password.");
         return;
      }

      const result = await api("/api/create", { username, password });
      createForm.reset();
      status.textContent = result.message + " ";
      const link = document.createElement("a");
      link.href = "/";
      link.textContent = "Go to login";
      status.append(link);
   }, message => alert(message));
}

const surveyForm = byId("survey-form");

if (surveyForm) {
   const status = byId("survey-status");
   const fieldset = surveyForm.querySelector("fieldset");
   const saveButton = surveyForm.querySelector('button[type="submit"]');
   fieldset.disabled = true;
   saveButton.disabled = true;

   api("/api/form").then(({ answers }) => {
      if (answers) {
         byId("place").value = answers.place;
         byId("time").value = answers.time;
         byId("music").checked = answers.music;
         byId("notes").value = answers.notes;

         for (const radio of surveyForm.querySelectorAll('[name="preference"]')) {
            radio.checked = radio.value === answers.preference;
         }
      }

      fieldset.disabled = false;
      saveButton.disabled = false;
   }).catch(error => {
      status.textContent = error.message;
   });

   handleSubmit(surveyForm, async () => {
      status.textContent = "Saving...";
      const selected = surveyForm.querySelector('[name="preference"]:checked');

      const result = await api("/api/form", {
         place: byId("place").value,
         time: byId("time").value,
         preference: selected ? selected.value : "",
         music: byId("music").checked,
         notes: byId("notes").value
      });

      status.textContent = result.message;
   }, message => {
      status.textContent = message;
   });
}

const accountSelect = byId("account-select");

if (accountSelect) {
   const status = byId("records-status");
   const table = byId("records-table");
   accountSelect.disabled = true;

   api("/api/records").then(({ records }) => {
      const submitted = records.filter(record => record.answers !== null);

      byId("total-submitted").textContent = submitted.length;
      byId("total-alone").textContent =
         submitted.filter(record => record.answers.preference === "Alone").length;
      byId("total-group").textContent =
         submitted.filter(record => record.answers.preference === "With a group").length;

      for (const record of records) {
         accountSelect.add(new Option(record.id, record.id));
      }

      accountSelect.disabled = records.length === 0;
      if (!records.length) status.textContent = "No accounts have been created yet.";

      accountSelect.addEventListener("change", () => {
         const record = records.find(entry => entry.id === accountSelect.value);
         table.hidden = !record;

         if (!record) {
            status.textContent = "";
            return;
         }

         const answers = record.answers;
         status.textContent = answers ? "" : "This account has not submitted a survey.";

         for (const field of ["place", "time", "preference", "notes"]) {
            byId("record-" + field).textContent = answers?.[field] || "Not answered";
         }

         byId("record-music").textContent =
            answers ? (answers.music ? "Yes" : "No") : "Not answered";
      });
   }).catch(error => {
      status.textContent = error.message;
   });
}

const logoutButton = byId("logout-button");

if (logoutButton) {
   logoutButton.addEventListener("click", async () => {
      try {
         await api("/api/logout", {});
         window.location.assign("/");
      } catch (error) {
         alert(error.message);
      }
   });
}
