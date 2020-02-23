require('dotenv').config();
const Discord = require('discord.js');
const client = new Discord.Client();
const { DiscordTagReplacer, UrlReplacer, EmojiReplacer } = require('./utils/replacer');
const { DiscordServer } = require('./models/discordserver');
const { MessageContext } = require('./contexts/messagecontext');
const { AudioAdapterManager } = require('./adapters/audioadapter');
const { FileAdapterManager, FileAdapterErrors } = require('./adapters/fileadapter');

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

AudioAdapterManager.init({
    ebyroid: {
        baseUrl: 'http://localhost:4090/'
    }
});

FileAdapterManager.init();

/**
 * @type {Map<string, DiscordServer>}
 */
let servers = new Map();

client.on('message', async (message) => {
    if (message.author.id === client.user.id) {
        // 自分のメッセージは無視
        return;
    }
    if (!message.guild) {
        // DMとかは無視
        console.info('処理されなかったメッセージ', message);
        return;
    }
    
    const key = message.guild.id;

    /** @type {DiscordServer} */
    let server;
    
    if (servers.has(key)) {
        server = servers.get(key);
        if (server.isInitializing) {
            console.info('初期化中なので無視したメッセージ', message);
            return;
        }
        if (!server.isCommandMessage(message) && !server.isMessageToReadOut(message)) {
            // コマンドじゃない＆読み上げないなら，性能要件のためここで切り上げる
            // （ここを通過してもawaitが絡むので後々の分岐で蹴られる場合がある）
            console.info(`pass: ${message.content}`);
            return;
        } 
    } else {
        server = new DiscordServer(message.guild);
        servers.set(key, server);
        try {
            await server.init();
        } catch (err) {
            servers.set(key, null);
            console.error('初期化失敗', err);
            return;
        }
    }

    const voiceJoin = async () => {
        await server.vc.join(message.member.voiceChannel);
        server.mainChannel = message.channel;
        return `${message.channel}`;
    }

    const voiceLeave = () => {
        server.vc.leave();
        server.mainChannel = null;
    }

    const context = new MessageContext({
        isMainChannel: !!(server.mainChannel) && (message.channel.id === server.mainChannel.id),
        isAuthorInVC: !!(message.member.voiceChannel),
        isJoined: () => server.vc.isJoined,
        isSpeaking: () => (server.vc.isStreaming || (server.vc.queueLength > 0)),
        queueLength: () => server.vc.queueLength,
        queuePurge: () => server.vc.clearQueue(),
        voiceJoin, voiceLeave,
        voiceCancel: (x) => server.vc.killStream(x),
        resolveUserName: (x) => message.mentions.users.find('id', x).username,
        resolveRoleName: (x) => message.guild.roles.find('id', x).name,
        resolveChannelName: (x) => message.guild.channels.find('id', x).name,
    });

    // コンテキストが確定した時点で絵文字とタグの一括置換を行う
    message.content = EmojiReplacer.replace(message.content);
    message.content = DiscordTagReplacer.replace(context, message.content);

    console.info(message.content);

    if (server.isCommandMessage(message)) {
        try {
            const result = await server.handleMessage(context, message);
            if (result.replyText) {
                await message.reply(result.replyText);
            }
        } catch (err) {
            console.error(err);
            return; // TODO: 例外処理これでいい？
        }

    } else if (server.isMessageToReadOut(message)) {

        let text = message.content;

        // URL置換
        text = UrlReplacer.replace(text);

        // リプレーサーによる置換
        text = server.handleReplace(context, text);

        console.info(text);

        // リクエストコンバーターによる変換
        requests = server.createRequests(context, text);

        // リクエストの実行
        let stream;
        try {
            stream = await AudioAdapterManager.request(...requests);
        } catch (err) {
            if (err === FileAdapterErrors.NOT_FOUND) {
                console.warn('index.js: リクエストしたファイルが見つからなかった。');
                console.warn('requests:', requests);
                return;
            } else {
                console.error('index.js: 未知のエラー');
                console.error('error:', err);
                return;
            }
        }

        // awaitが絡んだのでここではnullの可能性があるよ
        if (!server.vc.isJoined) {
            console.info('オーディオリクエスト中にVC切断されてました。', message.guild.name);
            stream.destroy();
            return;
        }

        server.vc.push(stream);
    }
});

client.login(process.env.TOKEN);

