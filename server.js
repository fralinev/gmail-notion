/*  EXPRESS */
const express = require("express");
const app = express();
const session = require("express-session");
require("dotenv").config();
const { google } = require("googleapis");

const { Client } = require("@notionhq/client");
const notion = new Client({
  auth: process.env.NOTION_KEY,
});

app.set("view engine", "ejs");

app.use(
  session({
    resave: false,
    saveUninitialized: true,
    secret: "SECRET",
  })
);

app.get("/", function (req, res) {
  res.render("pages/auth");
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("App listening on port " + port));

var passport = require("passport");
var userProfile;

app.use(passport.initialize());
app.use(passport.session());

app.get("/success", (req, res) => {
  res.render("pages/success", { user: userProfile.profile });
});
app.get("/error", (req, res) => res.send("error logging in"));

app.get("/logout", function (req, res) {
  req.logout(function (err) {
    if (err) {
      // handle error
      console.log("Error : Failed to logout.", err);
      return res.redirect("/error");
    }
    req.session.destroy(function (err) {
      if (err) {
        console.log(
          "Error : Failed to destroy the session during logout.",
          err
        );
      }
      res.redirect("/");
    });
  });
});

passport.serializeUser(function (user, cb) {
  cb(null, user);
});

passport.deserializeUser(function (obj, cb) {
  cb(null, obj);
});

/*  Google AUTH  */

var GoogleStrategy = require("passport-google-oauth").OAuth2Strategy;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.REDIRECT_URL,
    },
    function (accessToken, refreshToken, profile, done) {
      userProfile = { profile, accessToken, refreshToken };
      return done(null, userProfile);
    }
  )
);

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: [
      "profile",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
    prompt: "select_account",
  })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/error" }),
  function (req, res) {
    // Successful authentication, redirect success.
    res.redirect("/success");
  }
);

const gmailIds = [];

app.get("/sync", async (req, res) => {
  try {
    // ----------------- Get starred messages

    // pull tokens out of requests and put them in variables,
    // set up timer function and kick it off using the new variables, without using request object.
    // need global variable for timer id.

    console.log(new Date().toLocaleTimeString());

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: req.user.accessToken,
      refresh_token: req.user.refreshToken,
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const database = await notion.databases.query({
      database_id: process.env.NOTION_DB_ID,
    });

    const linksInArchivedPage = await notion.blocks.children.list({
      block_id: process.env.NOTION_ARCHIVED_ID,
    });
    const filteredLinksInArchivedPage = linksInArchivedPage.results.filter(
      (child) => child.type === "link_to_page"
    );
    const linksInPriorityBlock = await notion.blocks.children.list({
      block_id: process.env.NOTION_PRIORITY_ID,
    });
    const filteredLinksInPriorityBlock = linksInPriorityBlock.results.filter(
      (child) => child.type === "link_to_page"
    );
    const linksInUncategorizedBlock = await notion.blocks.children.list({
      block_id: process.env.NOTION_UNCATEGORIZED_ID,
    });
    const filteredLinksInUncategorizedBlock =
      linksInUncategorizedBlock.results.filter(
        (child) => child.type === "link_to_page"
      );
    // const linksInStarredPaged = await notion.blocks.children.list({
    //   block_id: process.env.NOTION_STARRED_ID,
    // });
    // const filteredLinksInStarredPage = linksInStarredPaged.results.filter(
    //   (child) => child.type === "link_to_page"
    // );

    for (let entry of database.results) {
      const archivedLink = filteredLinksInArchivedPage.find(
        (link) => link.link_to_page.page_id === entry.id
      );

      // CACHING

      // const cached = gmailIds.includes(
      //   entry.properties.gmail_id.rich_text[0].text.content
      // );

      // if (!cached && entry.archived === false) {
      //   gmailIds.push(entry.properties.gmail_id.rich_text[0].text.content);
      // }

      if (
        archivedLink &&
        entry.properties.arkived.rich_text[0].text.content === "false"
      ) {
        // await
        await notion.pages.update({
          page_id: entry.id,
          properties: {
            arkived: {
              rich_text: [
                {
                  type: "text",
                  text: {
                    content: "true",
                  },
                },
              ],
            },
          },
        });
        console.log(
          "----------------------++++++++ EUIEUIUEIUEI",
          entry.properties.arkived.rich_text[0].text.content
        );
        // await
        await gmail.users.messages.modify({
          userId: "me",
          id: entry.properties.gmail_id.rich_text[0].text.content,
          requestBody: {
            removeLabelIds: ["STARRED"],
          },
        });
      }

      if (
        !archivedLink &&
        entry.properties.arkived.rich_text[0].text.content === "true"
      ) {
        console.log("deleting: ", entry.id);
        await notion.blocks.delete({
          block_id: entry.id,
        });
      }
    }

    const { data } = await gmail.users.messages.list({
      userId: "me",
      q: "is:starred",
    });

    const messages = data.messages
      ? await Promise.all(
          data.messages.map((message) =>
            gmail.users.messages.get({
              userId: "me",
              id: message.id,
            })
          )
        )
      : [];

    console.log("Messages: ", messages.length);

    for (let message of messages) {
      const exists = database.results.find(
        (entry) =>
          entry.properties.gmail_id.rich_text[0].text.content ===
          message.data.id
      );

      if (exists) {
        continue;
      }

      const subject = message.data.payload.headers.find(
        (header) => header.name === "Subject"
      );

      const response = await notion.pages.create({
        parent: {
          type: "database_id",
          database_id: process.env.NOTION_DB_ID,
        },
        properties: {
          Name: {
            title: [
              {
                type: "text",
                text: {
                  content: subject.value,
                },
              },
            ],
          },
          snippet: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: message.data.snippet,
                },
              },
            ],
          },
          website: {
            url: `https://mail.google.com/mail/u/0/#inbox/${message.data.id}`,
          },
          gmail_id: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: message.data.id,
                },
              },
            ],
          },
          arkived: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: "false",
                },
              },
            ],
          },
        },
      });
      // await
      await notion.blocks.children.append({
        block_id: process.env.NOTION_UNCATEGORIZED_ID,
        children: [
          {
            type: "link_to_page",
            link_to_page: {
              type: "page_id",
              page_id: response.id,
            },
          },
        ],
      });
    }

    for (let entry of database.results) {
      const found = messages.find(
        (message) =>
          message.data.id ===
          entry.properties.gmail_id.rich_text[0].text.content
      );

      const ark = await notion.pages.properties.retrieve({
        page_id: entry.id,
        property_id: "zxkb",
      });
      console.log("ark: ", ark.results[0].rich_text.text.content);
      if (!found && ark.results[0].rich_text.text.content === "false") {
        console.log("hit mogo");

        // move to archive

        await notion.pages.update({
          page_id: entry.id,
          properties: {
            arkived: {
              rich_text: [
                {
                  type: "text",
                  text: {
                    content: "true",
                  },
                },
              ],
            },
          },
        });

        await notion.blocks.children.append({
          block_id: "fb8738478586481c96e6b8cc4c740833",
          children: [
            {
              type: "link_to_page",
              link_to_page: {
                type: "page_id",
                page_id: entry.id,
              },
            },
          ],
        });
        console.log(filteredLinksInUncategorizedBlock);
        const toBeRemoved =
          filteredLinksInPriorityBlock.find(
            (link) => link.link_to_page.page_id === entry.id
          ) ||
          filteredLinksInUncategorizedBlock.find(
            (link) => link.link_to_page.page_id === entry.id
          );
        console.log("deleting...", toBeRemoved?.id);
        // await
        await notion.blocks.delete({
          block_id: toBeRemoved.id,
        });
      }
    }

    console.log("finishing up...");
    console.log(new Date().toLocaleTimeString());

    res.end();
  } catch (error) {
    console.log("Error: ", error);
    res.status(500).send("Error retrieving starred messages");
  }
});
