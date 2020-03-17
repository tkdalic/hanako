const path = require('path');
const logger = require('log4js').getLogger(path.basename(__filename));
const MessageValidator = require('../service/message_validator');
const MessageBuilder = require('../service/message_builder');
const MessageService = require('../service/message_service');

/** @typedef {import('discord.js').Client} discord.Client */
/** @typedef {import('discord.js').Message} discord.Message */

class MessageCtrl {
    /**
     * @param {discord.Client} client Discord Botのクライアント
     */
    constructor(client) {
        this.client = client;
        this.validator = new MessageValidator();
        this.builder = new MessageBuilder();
    }

    /**
     * @param {discord.Message} message
     */
    async onMessage(message) {
        // バリデーション
        const validatorParam = {
            isBot: message.author.bot,
            isHanako: message.author.id === this.client.user.id,
            content: message.content,
            userName: message.author.username,
            channelType: message.channel.type,
        };
        await this.validator.validate(validatorParam);
        // エンティティの作成
        const builderParam = {
            id: message.id,
            isHanako: message.author.id === this.client.user.id,
            isHanakoMentioned: message.mentions.has(this.client.user),
            content: message.content,
            userId: message.author.id,
            userName: message.author.username,
            channelId: message.channel.id,
            channelName: message.channel.name,
            serverId: message.guild.id,
            serverName: message.guild.name,
            secret: typeof message.nonce === 'number' ? message.nonce >>> 0 : 0,
        };
        const entity = await this.builder.build(builderParam);
        logger.info(entity);
        // TODO FIX これはモック
        const service = new MessageService();
        await service.serve(entity);
    }
}

module.exports = MessageCtrl;
