const path = require('path');
const logger = require('log4js').getLogger(path.basename(__filename));
const assert = require('assert').strict;
const emoji = require('node-emoji');
const Injector = require('../core/injector');
const IDiscordServerRepo = require('../domain/repos/i_discord_server_repo');
const DiscordMessage = require('../domain/entities/discord_message');

/**
 * @typedef MessageBuilderData
 * @type {object}
 *
 * @property {string} id
 * @property {boolean} isHanako
 * @property {boolean} isHanakoMentioned
 * @property {string} content
 * @property {string} userId
 * @property {string} userName
 * @property {string} channelId
 * @property {string} channelName
 * @property {string} serverId
 * @property {string} serverName
 * @property {number} secret
 */

/**
 * アプリケーションサービス
 * DiscordMessageエンティティの構築
 */
class MessageBuilder {
    /**
     * @param {IDiscordServerRepo?} serverRepo
     */
    constructor(serverRepo = null) {
        this.serverRepo = serverRepo || Injector.resolve(IDiscordServerRepo);
    }

    /**
     * DiscordMessageエンティティの構築
     * @param {MessageBuilderData} param
     * @returns {Promise<DiscordMessage>}
     */
    async build(param) {
        assert(typeof param.id === 'string');
        assert(typeof param.isHanako === 'boolean');
        assert(typeof param.isHanakoMentioned === 'boolean');
        assert(typeof param.content === 'string');
        assert(typeof param.userId === 'string');
        assert(typeof param.userName === 'string');
        assert(typeof param.channelId === 'string');
        assert(typeof param.channelName === 'string');
        assert(typeof param.serverId === 'string');
        assert(typeof param.serverName === 'string');
        assert(typeof param.secret === 'number' && Number.isInteger(param.secret) && param.secret >= 0);

        let data = Object.assign({}, param);
        data = await processSecretF.call(this, data);
        data = await processReplaceF.call(this, data);

        const server = await this.serverRepo.loadOrCreate(data.serverId);
        const type = await inferMessageTypeF.call(this, data, server);

        const dmessage = new DiscordMessage({
            id: data.id,
            content: data.content,
            type: type,
        });

        return Promise.resolve(dmessage);
    }
}

/**
 * @this {MessageBuilder}
 * @param {MessageBuilderData} data
 * @returns {Promise<MessageBuilderData>}
 */
async function processSecretF(data) {
    if (data.isHanako && data.secret >>> 16 === 0xebeb) {
        // 命令が埋め込まれていた場合
        logger.info('インターナル命令を受信', data.secret.toString(16));
        const opcode = (data.secret & 0xffff) >>> 0;
        let content = data.content;
        let tmp;
        switch (opcode) {
            case 0x0001:
                // 復帰命令
                tmp = content.split(' ');
                tmp[1] = 'plz';
                content = tmp.slice(0, 2).join(' ');
                break;
            default:
                logger.error('未知のインターナル命令', data);
                // TODO FIX 中断エラーの共通化
                return Promise.reject(0);
        }
        data.content = content;
    }
    return Promise.resolve(data);
}

/**
 * @this {MessageBuilder}
 * @param {MessageBuilderData} data
 * @returns {Promise<MessageBuilderData>}
 */
async function processReplaceF(data) {
    data.content = emoji.replace(data.content, emoji => `:${emoji.key}:`);
    // TODO FIX 境界に依存するDiscordTagReplacerはUtilではない
    // data.content = DiscordTagReplacer.replace(this.context, data.content);
    return Promise.resolve(data);
}

/**
 * @this {MessageBuilder}
 * @param {MessageBuilderData} data
 * @param {import('../domain/models/discord_server')} server
 * @returns {Promise<'command'|'read'>}
 */
async function inferMessageTypeF(data, server) {
    // 花子がメンションされているか、コマンドプリフィクスを持つならコマンド
    if (data.isHanakoMentioned || server.hasCommandPrefix(data.content)) {
        return Promise.resolve('command');
    }
    // それ以外で、読み上げ対象のチャンネルなら読み上げ
    if (server.isReadingChannel(data.channelId)) {
        return Promise.resolve('read');
    }
    // どちらでもなければ無視
    logger.trace(`pass: ${data.serverName} #${data.channelName} @${data.userName} ${data.content}`);
    // TODO FIX errortype
    return Promise.reject(0);
}

module.exports = MessageBuilder;
