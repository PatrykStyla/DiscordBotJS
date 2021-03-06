import { Collection, GuildEmoji, Message, MessageAttachment, PartialMessage, User } from "discord.js";
import { client, ctx, database, GetFetchLogsSingle } from "..";
import { WebSocket, SendMessageToWebSocket } from "../WebSocketClient";
import { DiscordBotJS } from "/home/ubuntu/DiscordBotJS/ProtoOutput/compiled";
import https from "https";
import fs from "fs";
import FfmpegCommand from 'fluent-ffmpeg'
import { HasBossMusic, PlayBossMusic } from "./Voice";
import ydtl from "ytdl-core";
// TODO: Unifined path with voice.ts
const BossMusicFilePath = "/home/ubuntu/DiscordBotJS/audioClips/"

/** MAYBE: Add timeout to delete old entires to prevent a very large data set */
const DMChanellsSet = new Set<string>();
let botCommands: {
	[key: string]: {
		name: string,
		description: string
	}
} = {
	add: {
		name: "add",
		description: "add a song 20 secs max"
	},
	playboss: {
		name: "playboss",
		description: "play someone else boss music @name at the end"
	},
	help: {
		name: "help",
		description: "list available commands"
	}
}


// messageDelete
/* Emitted whenever a message is deleted.
PARAMETER      TYPE           DESCRIPTION
message        Message        The deleted message    */
// Uses PartialMessage otherwise it won't fire for non-cached messages
client.on("messageDelete", async (message) => {
	// Ignore DM deletions
	if (!message.guild) {
		database.DeleteMessage(message as PartialMessage);

		return;
	}
	const deletionLog = await GetFetchLogsSingle(message, 'MESSAGE_DELETE');
	let executor: User | null = null, target: any | null = null


	if (!deletionLog) {
		database.DeleteMessage(message as PartialMessage);
	} else {
		({ executor, target } = { executor: deletionLog.executor, target: deletionLog.target! });

		if ((target as Message).id === message.id) {
			// Log matches the created channel
			database.DeleteMessage(message as PartialMessage, executor.id);
		} else {
			// TODO: We don't know the author of the message if it is not cached.
			// There is a chance we have that message in our db and know the author
			// In this case we can safelly find the executor.
			// REMINDER: own mesage deletion WILL NOT TRIGGER ANY LOGS
			database.DeleteMessage(message as PartialMessage);
		}
	}

	const BotMessage = DiscordBotJS.BotResponse.create({
		id: message.id,
		guild_id: message.guild!.id!,
		botDeleteMessage: {
			channel_id: message.channel.id,
			executor: executor?.id,
			is_deteled: true
		}
	})
	const Encoded = DiscordBotJS.BotResponse.encode(BotMessage).finish();
	SendMessageToWebSocket(Encoded)
	return
});

// messageDeleteBulk
/* Emitted whenever messages are deleted in bulk.
PARAMETER    TYPE                              DESCRIPTION
messages     Collection<Snowflake, Message>    The deleted messages, mapped by their ID    */
// Uses PartialMessage otherwise it won't fire for non-cached messages
client.on("messageDeleteBulk", async (messages) => {
	const fetchedLogs = await messages.first()?.guild?.fetchAuditLogs({
		limit: 1,
		type: 'MESSAGE_BULK_DELETE',
	});

	const deletionLog = fetchedLogs?.entries.first();

	if (!deletionLog) {
		database.DeleteMessages(messages as Collection<string, PartialMessage>);
		return // No logs for this deletion
	}

	// const a = database.GetDeletionLogByTimestamp(deletionLog.createdTimestamp);

	if (false) {
		// TODO: FIX
		// No way to EASILY and reliably find who is the executor
		// It involves adding the timestamp and seeing if there is a different count of objects deletd
		// We know who deleted the message
		// database.DeleteMessagesExecutor(messages as Collection<string, PartialMessage>, deletionLog.executor.id, deletionLog.createdTimestamp);
	} else {
		// The log doesn't match up with the action.
		// We don't know who deleted the message
		database.DeleteMessages(messages as Collection<string, PartialMessage>);
	}

	database.DeleteMessages(messages as Collection<string, PartialMessage>);
});

/* Emitted whenever a message is updated - e.g. embed or content change.
PARAMETER     TYPE           DESCRIPTION
oldMessage    Message        The message before the update
newMessage    Message        The message after the update   
Realisticallty only the message content will be changed by a user.
Bots can eddit embeds and attachments but that wont be supported(?)
*/
// TODO: Executor
client.on("messageUpdate", async (oldMessage, newMessage) => {
	let executor: any = null
	if (oldMessage.content === null) {
		// Updating messages that are not cached do not generate any data(except ID) for oldMessage
		// Try to find the message in our DB
		const DBMessage = await database.GetMessage(newMessage.id);
		if (!DBMessage[0]) {
			// There is a very high possiblity that no fields will be returned
			// TODO: There is a possibility the user was not recorded when the message was sent
			// AND that user is no longer in the channel(and) causing an error
			if (!newMessage.author)
				newMessage = await newMessage.fetch()

			// We don't have that message in our DB
			// Add the new message(edit) as is.
			// Return since we don't know what chnaged from the previous message
			database.AddMessage(newMessage as Message);
			// TODO: Send the message back??
			return;
		} else {
			if (DBMessage[0].content !== newMessage.content) {
				// we have the message. Update it and add a log
				database.UpdateMessage(DBMessage[0], newMessage as Message);

				const BotMessage = DiscordBotJS.BotResponse.create({
					id: newMessage.id,
					guild_id: newMessage.guild!.id,
					botEditMessage: {
						channel_id: DBMessage[0].channel_id,
						executor: executor?.id,
						content: newMessage.content!,
						is_edited: true
					}
				})
				const Encoded = DiscordBotJS.BotResponse.encode(BotMessage).finish();
				SendMessageToWebSocket(Encoded)
			} else if (DBMessage[0].is_pinned !== newMessage.pinned) {
				// Message was pinned/unpinned
				if (newMessage.pinned) {
					// Pinned
				} else {
					// Unpinned
				}
			}
		}
		return
	} else {
		// message is cached
		if (oldMessage.content !== newMessage.content) {
			// we have the message. Update it and add a log
			database.UpdateMessageAPI(oldMessage as Message, newMessage as Message);
			const BotMessage = DiscordBotJS.BotResponse.create({
				id: newMessage.id,
				guild_id: newMessage.guild!.id,
				botEditMessage: {
					channel_id: newMessage.channel.id,
					executor: executor?.id,
					content: newMessage.content!,
					is_edited: true
				}
			})
			const Encoded = DiscordBotJS.BotResponse.encode(BotMessage).finish();
			SendMessageToWebSocket(Encoded)
		} else if (oldMessage.pinned !== newMessage.pinned) {
			// Message was pinned/unpinned
			if (newMessage.pinned) {
				// Pinned
			} else {
				// Unpinned
			}
		}
	}

});

let BotPrefix = "!piss";

async function download(url: string, dest: string, fileName: string, user_id: string, msg: Message) {
	https.get(url, (res) => {
		const fileStream = fs.createWriteStream(dest)
		res.pipe(fileStream);
		fileStream.on("finish", () => {
			fileStream.close()
			FfmpegCommand(dest).ffprobe((err, data) => {
				if (err) {
					msg.channel.send("Failed. Something went wrong")
					return;
				}
				// Pretty confident it's an audio file
				if (data.streams[0].codec_type = 'audio') {
					if (data.format.duration! < 20.0) {
						// Can use a file or in our case a stream
						ConvertFFmpeg(dest, user_id, fileName, 0, 0, msg);
					} else {
						// > 20 sec
						msg.channel.send("Clips must be shorter than 20 sec")
					}
				} else {
					// Not an audio file(?)
					msg.channel.send("Not an audio file")
				}
			})

		})

		fileStream.on('error', (err) => {
			console.log('ERROR => ', err)
		})
	})
}

async function HandleMessageForBotCommands(msg: Message): Promise<void> {
	if (msg.content.startsWith(BotPrefix)) {
		// Bot command
		const args = msg.content.slice(BotPrefix.length).trim().split(/ +/);
		console.log(args);
		const command = args.shift()!.toLowerCase();

		if (command === botCommands.add.name) {
			// Add via attachment
			if (msg.attachments.size > 0) {
				AddMusicViaAttachment(msg);
			} else {
				// add via text (Youtube link)
				AddMusicViaYTLink(args, msg);
			}
		}
		else if (command === botCommands.playboss.name) {
			PlayBossMusicViaMsg(args, msg);
		} else if (command === botCommands.help.name) {
			let text = ""
			for (const [_key, value] of Object.entries(botCommands)) {
				text += `${value.name} - ${value.description} \n`;
			  }
			msg.reply(`The current available commands are \n ${text}`)
		}
		else {
			msg.channel.send(`Unkown command ${command}. Type ${BotPrefix} help for all the available commands`);
		}

		console.log(command);
	}
}

client.on("message", async (msg) => {
	// Ignore own messages. This can cause infinte loops
	if (msg.author.id === client.user?.id) {
		database.AddMessageDM(msg);
		return;
	}
	// Private messages.
	if (msg.channel.type === "dm") {
		// Check if we have that channel in our DB from a local state
		if (DMChanellsSet.has(msg.channel.id)) {
			// We have the channel. Add the message to the DB
			database.AddMessageDM(msg);
		} else {
			// Query DB and add the result to the local state
			let DMChannelFromDB = await database.GetDMChannel(msg.channel)
			if (DMChannelFromDB[0]) {
				// We have that channel in our DB
			} else {
				// We don't have the chanel. Add it
				//await database.AddChannels([msg.channel])
				await database.AddDMChannel(msg.channel);
			}
			DMChanellsSet.add(msg.channel.id)

			database.AddMessageDM(msg);
		}
		msg.reply("Some placeholder functionality");
		return;
	}

	if (msg.type === "DEFAULT") {
		database.AddMessage(msg);
		HandleMessageForBotCommands(msg);
		// send the message to all clients

		const BotMessage = DiscordBotJS.BotResponse.create({
			id: msg.id,
			guild_id: msg.guild!.id,
			botMessage: {
				channel_id: msg.channel.id,
				content: msg.content,
				author: msg.author.id,
				username: msg.author.username,
				nickname: msg.guild!.members.cache.get(msg.author.id)!.nickname,
				attachments: msg.attachments.size > 0 ? {
					[msg.attachments.first()!.id]: {
						id: msg.attachments.first()!.id,
						name: msg.attachments.first()!.name,
						url: msg.attachments.first()!.url
					}
				} : null
			}
		})

		const Encoded = DiscordBotJS.BotResponse.encode(BotMessage).finish();

		SendMessageToWebSocket(Encoded)
		return;
	} else if (msg.type === "PINS_ADD") {
		database.UpdateChannelPins(msg);
	} else {
		ctx.redBright(`Unimplemented type`)
		throw new Error(`"Method not implemented. Type: ${msg.type}"`);
	}

	return;
});

// messageReactionAdd
/* Emitted whenever a reaction is added to a message.
PARAMETER              TYPE                   DESCRIPTION
messageReaction        MessageReaction        The reaction object
user                   User                   The user that applied the emoji or reaction emoji     */
client.on("messageReactionAdd", (messageReaction, user) => {
	console.log(`a reaction is added to a message`);
});

// messageReactionRemove
/* Emitted whenever a reaction is removed from a message.
PARAMETER              TYPE                   DESCRIPTION
messageReaction        MessageReaction        The reaction object
user                   User                   The user that removed the emoji or reaction emoji     */
client.on("messageReactionRemove", (messageReaction, user) => {
	console.log(`a reaction is removed from a message`);
});

// messageReactionRemoveAll
/* Emitted whenever all reactions are removed from a message.
PARAMETER          TYPE           DESCRIPTION
message            Message        The message the reactions were removed from    */
client.on("messageReactionRemoveAll", (message) => {
	console.error(`all reactions are removed from a message`);
});

// typingStart
/* Emitted whenever a user starts typing in a channel.
PARAMETER      TYPE            DESCRIPTION
channel        Channel         The channel the user started typing in
user           User            The user that started typing    */
client.on("typingStart", (channel, user) => {
	console.log(`${user.id} has started typing`);

});

function PlayBossMusicViaMsg(args: string[], msg: Message) {
	let command = args.shift();
	if (!command) {
		msg.reply("No id");
		return;
	}
	const matches = command.match(/^<?@?!?(\d{18,20})>?$/);

	if (!matches) {
		// Something went wrong
		msg.reply("wrong id");
		return;
	}
	const id = matches[1];

	const target = msg.guild?.members.cache.get(msg.member?.id!);

	if (!target) {
		// Target not found. This should not happen
		msg.reply("Target not found");
		return;
	}

	const VoiceState = target.voice;

	PlayBossMusic(VoiceState, id, msg);
}

function AddMusicViaYTLink(args: string[], msg: Message) {
	let command = args.shift();
	if (!command) {
		msg.reply("No url");
		return
	}
	// [0] for the full url
	const matches = command.match(/^(https?\:\/\/)?((www\.)?youtube\.com|youtu\.?be)\/.+$/);

	if (!matches) {
		msg.reply("Not a youtube url");
		return;
	}

	let time = args.shift()?.split(',')!;

	if (!time) {
		// No timestamps provided
		msg.reply("Provide a timestamp eg. x:xx,x:xx (20 secs max)");
		return;
	}

	let start = convert(time[0]);
	let finish = convert(time[1]);

	console.log(start)
	console.log(finish)

	if (finish - start > 20 ) {
		// No timestamps provided
		msg.reply("Max 20 seconds");
		return;
	}
	
	// Unique? id for temp audio file 
	const date = Date.now() * Math.floor(Math.random() * 100000);
	ydtl(matches![0], { filter: 'audioonly', quality: 'highestaudio' }).pipe(fs.createWriteStream(BossMusicFilePath + date)).on('finish', () => {
		// Process file with ffmpeg
		ConvertFFmpeg(BossMusicFilePath + date, msg.member?.id!, date.toString(), start, finish, msg);
	});
}

function AddMusicViaAttachment(msg: Message) {
	const name = msg.attachments.first()?.name!;
	const WhereIsLastDot = name.lastIndexOf('.');
	const fileName = name.slice(0, WhereIsLastDot);
	console.log(fileName);
	// find last dot to get the extension name
	const extension = name.slice(WhereIsLastDot);
	download(msg.attachments.first()?.url!, BossMusicFilePath + fileName, fileName, msg.author.id, msg);
}

function ConvertFFmpeg(dest: string, user_id: string, fileName: string, start: number = 0, end: number = 0, msg: Message) {
	let command = FfmpegCommand(dest);
	command.on('start', (a) => {
		console.log(a);
	})
	.inputOptions([`-ss ${start}`, `-t ${end - start}`])
	// the other functions set the output options and it wont work otherwise
	.outputOptions(['-c:a libopus', '-b:a 96k'])
	.on('start', function (commandLine) {
		console.log('Spawned Ffmpeg with command: ' + commandLine);
	})
	.on('end', function () {
		// Done with the temporary file remove.
		fs.unlink(dest, (err) => {
			if (err) {
				console.error(err);
				return;
			}
		});
		database.AddUserBossMusic(user_id, fileName);
		HasBossMusic.set(msg.member?.id!, fileName + '.ogg');

		msg.reply("Ok piss");
	})
	.on('error', function (err) {
		console.log('an error happened: ' + err);
	})
	.saveToFile(dest + '.ogg');
}

function convert(input: string) {
	// if length 0 index [0] is < 60 secs
	// if length 1 index [0] is < 60 min and index [1] is < 60 secs
	// if length 3 index [0] is < 60 hours, index [1] is < 60 min and index [2] is < 60 secs
	var a = input.split(':'); // split it at the colons
	let seconds = 0; 

	if (a.length === 1) {
		let b = parseInt(a[0])
		seconds = b;
	} else if (a.length === 2) {
		let b = parseInt(a[0])
		let bb = parseInt(a[1])
		seconds = (b * 60) + bb
	} else {
		let b = parseInt(a[0])
		let bb = parseInt(a[1])
		let bbb = parseInt(a[2])
		seconds = ((b * 60 * 60) + (bb * 60)) + bbb
	}

	return seconds
}
