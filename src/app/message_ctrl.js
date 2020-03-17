const path = require('path');
const logger = require('log4js').getLogger(path.basename(__filename));
const Injector = require('../core/injector');
const MessageBuilder = require('../service/message_builder');
const MessageService = require('../service/message_service');
const { MessageContext } = require('../contexts/messagecontext');
const { UrlReplacer } = require('../utils/replacer');
const { AudioAdapterManager } = require('../adapters/audioadapter');
const { FileAdapterErrors } = require('../adapters/fileadapter');
const { ContentType } = require('../commands/commandresult');
const IDiscordServerRepo = require('../domain/repos/i_discord_server_repo');

/** @typedef {import('discord.js').Client} discord.Client */
/** @typedef {import('discord.js').Message} discord.Message */

function handleUncaughtError(err) {
    if (err === 0) {
        // TODO FIX 中断エラー共通化
        return Promise.resolve();
    }

    // Note: ここまでエラーが来る === 未知のエラー
    logger.error('予期されないエラーが発生。', err);
    return Promise.resolve();
}

class MessageCtrl {
    /**
     * @param {discord.Client} client
     */
    constructor(client, servers) {
        this.client = client; // TODO 持ってないとだめ？
        this.servers = servers; // TODO FIX

        // TODO FIX Repoはこの層(app)にDIされない
        this.serverRepo = Injector.resolve(IDiscordServerRepo);

        this.client.on('message', message => this.onMessage(message).catch(handleUncaughtError));
    }

    /**
     * @param {discord.Message} message
     */
    async onMessage(message) {
        // TODO FIX
        if (!message.guild) return;
        // TODO FIX
        const key = message.guild.id;

        // TODO FIX
        const server = await this.serverRepo.loadOrCreate(key);

        const voiceJoin = async () => {
            await server.vc.join(message.member.voice.channel);
            server.mainChannel = message.channel;
            return `${message.channel}`;
        };

        const voiceLeave = () => {
            server.vc.leave();
            server.mainChannel = null;
        };

        const resolveUserName = userId => {
            const member = message.mentions.members.find(m => userId === m.id);
            if (member) {
                return member.displayName;
            } else {
                // Discordタグ直打ちの場合
                return '誰ですか？';
            }
        };

        const context = new MessageContext({
            isMainChannel: !!server.mainChannel && message.channel.id === server.mainChannel.id,
            isAuthorInVC: !!message.member.voice.channel,
            isJoined: () => server.vc.isJoined,
            isSpeaking: () => server.vc.isStreaming || server.vc.queueLength > 0,
            queueLength: () => server.vc.queueLength,
            queuePurge: () => server.vc.clearQueue(),
            voiceJoin,
            voiceLeave,
            voiceCancel: () => server.vc.killStream(),
            authorId: message.author.id,
            mentionedUsers: message.mentions.members.reduce((map, m) => map.set(m.displayName, m.id), new Map()),
            resolveUserName,
            resolveRoleName: x => message.mentions.roles.find(r => x === r.id).name,
            resolveChannelName: x => message.mentions.channels.find(c => x === c.id).name,
        });

        const builder = new MessageBuilder(this.client, message, context);
        const dmessage = await builder.build({
            id: message.id,
            content: message.content,
            userId: message.author.id,
            userName: message.author.username,
            channelId: message.channel.id,
            channelName: message.channel.name,
            serverId: message.guild.id,
            serverName: message.guild.name,
            type: message.channel.type,
            isBot: message.author.bot,
            secret: typeof message.nonce === 'number' ? message.nonce >>> 0 : 0,
        });
        logger.info(dmessage);

        // TODO FIX これはモック
        const service = new MessageService();
        const tmp = await service.serve(dmessage);
        logger.info(tmp);

        // TODO FIX とりあえず動かすためにやっている
        message.content = dmessage.content;

        if (server.isCommandMessage(message)) {
            try {
                const result = await server.handleMessage(context, message);
                if (result.replyText) {
                    const sentMessage = await message.channel.send(result.replyText);
                    if (result.contentType === ContentType.PAGER) {
                        await sentMessage.react('👈');
                        await sentMessage.react('👉');
                    }
                }
            } catch (err) {
                logger.error('コマンド処理でエラー', err);
                return;
            }
        } else if (server.isMessageToReadOut(message)) {
            let text = message.content;

            // URL置換
            text = UrlReplacer.replace(text);

            // リプレーサーによる置換
            text = server.handleReplace(context, text);

            logger.trace('リクエスト直前のtext:', text);

            // リクエストコンバーターによる変換
            const requests = server.createRequests(context, text);

            logger.trace(requests);

            // リクエストの実行
            let stream;
            try {
                stream = await AudioAdapterManager.request(...requests);
            } catch (err) {
                if (err === FileAdapterErrors.NOT_FOUND) {
                    logger.warn('リクエストしたファイルが見つからなかった。', requests);
                    return;
                } else {
                    logger.error('オーディオリクエストでエラー', err);
                    return;
                }
            }

            // awaitが絡んだのでここではnullの可能性があるよ
            if (!server.vc.isJoined) {
                logger.info('オーディオリクエスト中にVC切断されてました。', message.guild.name);
                stream.destroy();
                return;
            }

            server.vc.push(stream);
        }
    }
}

module.exports = MessageCtrl;
