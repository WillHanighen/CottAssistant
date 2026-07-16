import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  type Message,
  type ChatInputCommandInteraction,
  type Attachment,
} from "discord.js";
import {
  type Agent,
  type Database,
  fetchImageAsChatImage,
  isImageMime,
  mimeFromFilename,
} from "@cottassistant/core";
import type { Actor, ChatImage } from "@cottassistant/shared";

export interface DiscordHandle {
  stop: () => Promise<void>;
  sendDm: (discordUserId: string, text: string) => Promise<boolean>;
}

const MAX_IMAGES = 4;

export async function startDiscordBot(opts: {
  token: string;
  db: Database;
  agent: Agent;
}): Promise<DiscordHandle> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Attachment],
  });

  const actorFor = (discordId: string): Actor => ({
    kind: "discord",
    id: discordId,
    allowSensitive: opts.db.isDiscordAuthorized(discordId),
  });

  async function replyToChat(
    discordUserId: string,
    channelKey: `discord:dm:${string}` | `discord:guild:${string}`,
    text: string,
    images: ChatImage[],
    send: (content: string) => Promise<unknown>,
  ): Promise<void> {
    const actor = actorFor(discordUserId);
    try {
      const reply = await opts.agent.chat(channelKey, actor, { text, images });
      await send(chunk(reply.text));
    } catch (err) {
      await send(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function sendDm(discordUserId: string, text: string): Promise<boolean> {
    try {
      const user = await client.users.fetch(discordUserId);
      await user.send(chunk(text));
      return true;
    } catch (err) {
      console.error(`Discord DM to ${discordUserId} failed:`, err);
      return false;
    }
  }

  client.once(Events.ClientReady, async (c) => {
    console.log(`Discord ready as ${c.user.tag}`);
    try {
      const rest = new REST({ version: "10" }).setToken(opts.token);
      const commands = [
        new SlashCommandBuilder()
          .setName("ask")
          .setDescription("Ask CottAssistant")
          .addStringOption((o) =>
            o.setName("prompt").setDescription("Your question").setRequired(true),
          )
          .addAttachmentOption((o) =>
            o.setName("image").setDescription("Optional image to analyze").setRequired(false),
          ),
        new SlashCommandBuilder().setName("status").setDescription("CottAssistant status"),
      ].map((cmd) => cmd.toJSON());
      await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    } catch (err) {
      console.error("Failed to register slash commands:", err);
    }
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;

    const isDm = !message.guild;
    const mentioned =
      Boolean(client.user) &&
      (message.mentions.has(client.user!) ||
        message.content.startsWith(`<@${client.user!.id}>`) ||
        message.content.startsWith(`<@!${client.user!.id}>`));

    if (!isDm && !mentioned) return;

    let text = message.content.trim();
    if (client.user) {
      text = text.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    }

    let images: ChatImage[] = [];
    try {
      images = await collectMessageImages(message);
    } catch (err) {
      await message.reply(
        `Couldn't read that image: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    if (!text && images.length === 0) {
      await message.reply("Yes? Send a message or an image.");
      return;
    }

    const channelKey = isDm
      ? (`discord:dm:${message.author.id}` as const)
      : (`discord:guild:${message.channelId}` as const);

    await message.channel.sendTyping().catch(() => undefined);
    await replyToChat(message.author.id, channelKey, text, images, (c) => message.reply(c));
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const i = interaction as ChatInputCommandInteraction;
    if (i.commandName === "status") {
      const authorized = opts.db.isDiscordAuthorized(i.user.id);
      await i.reply({
        content: `CottAssistant online. Sensitive tools: ${authorized ? "allowed" : "denied (add your Discord ID in WebUI)"}. Vision: image attachments supported. Crons: ${authorized ? "unlimited / complex OK" : "up to 3 simple jobs"}.`,
        ephemeral: true,
      });
      return;
    }
    if (i.commandName === "ask") {
      const prompt = i.options.getString("prompt", true);
      const attachment = i.options.getAttachment("image");
      await i.deferReply();
      const channelKey = i.guildId
        ? (`discord:guild:${i.channelId}` as const)
        : (`discord:dm:${i.user.id}` as const);
      try {
        const images: ChatImage[] = [];
        if (attachment) {
          images.push(...(await attachmentToImages([attachment])));
        }
        const actor = actorFor(i.user.id);
        const reply = await opts.agent.chat(channelKey, actor, { text: prompt, images });
        await i.editReply(chunk(reply.text));
      } catch (err) {
        await i.editReply(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  await client.login(opts.token);

  return {
    stop: async () => {
      client.destroy();
    },
    sendDm,
  };
}

async function collectMessageImages(message: Message): Promise<ChatImage[]> {
  const attachments = [...message.attachments.values()];
  const fromFiles = await attachmentToImages(attachments);

  // Also pick up image embeds (e.g. pasted links Discord unfurled)
  const fromEmbeds: ChatImage[] = [];
  for (const embed of message.embeds) {
    if (fromFiles.length + fromEmbeds.length >= MAX_IMAGES) break;
    const url = embed.image?.url ?? embed.thumbnail?.url;
    if (!url) continue;
    try {
      fromEmbeds.push(await fetchImageAsChatImage(url, "embed"));
    } catch {
      /* skip bad embeds */
    }
  }

  return [...fromFiles, ...fromEmbeds].slice(0, MAX_IMAGES);
}

async function attachmentToImages(attachments: Attachment[]): Promise<ChatImage[]> {
  const images: ChatImage[] = [];
  for (const att of attachments) {
    if (images.length >= MAX_IMAGES) break;
    const mime = att.contentType ?? mimeFromFilename(att.name);
    const looksImage =
      isImageMime(mime) ||
      Boolean(att.contentType?.startsWith("image/")) ||
      Boolean(mimeFromFilename(att.name));
    if (!looksImage) continue;
    images.push(
      await fetchImageAsChatImage(att.url, att.name, {
        maxBytes: 8 * 1024 * 1024,
      }),
    );
  }
  return images;
}

function chunk(text: string): string {
  if (text.length <= 1900) return text;
  return `${text.slice(0, 1900)}…`;
}
