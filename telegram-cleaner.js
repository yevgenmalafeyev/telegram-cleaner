#!/usr/bin/env node

import pkg from 'telegram';
const { TelegramClient } = pkg;
import { StringSession } from 'telegram/sessions/index.js';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs/promises';

/**
 * Configuration constants
 */
const CONFIG = {
  DIALOGS_LIMIT: 200,
  MESSAGES_LIMIT: 100,
  SESSION_FILE: 'telegram-session.json',
  CONFIG_FILE: 'telegram-config.json',
  MENU_OPTIONS: {
    MANAGE_POSTED: 'manage_posted',
    MANAGE_INACTIVE: 'manage_inactive',
    EXIT: 'exit'
  },
  GROUP_ACTIONS: {
    DELETE_ALL: 'delete_all',
    SHOW_FULL: 'show_full',
    BACK: 'back'
  }
};

/**
 * Utility functions
 */
class Utils {
  static formatDate(timestamp) {
    return timestamp ? new Date(timestamp * 1000).toLocaleDateString() : 'No activity';
  }

  static formatMessagePreview(text, maxLength = 50) {
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  }

  static async handleAsyncOperation(operation, errorMessage) {
    try {
      return await operation();
    } catch (error) {
      console.error(chalk.red(`❌ ${errorMessage}:`), error.message);
      return null;
    }
  }

  static validateCredential(input, fieldName) {
    return input.trim() !== '' || `${fieldName} is required`;
  }

  static credentialsEqual(cred1, cred2) {
    return cred1.apiId === cred2.apiId && 
           cred1.apiHash === cred2.apiHash && 
           cred1.phoneNumber === cred2.phoneNumber;
  }
}

/**
 * Configuration management
 */
class ConfigManager {
  constructor(configFile = CONFIG.CONFIG_FILE) {
    this.configFile = configFile;
  }

  /**
   * Load configuration from file
   * @returns {Object} Configuration object or empty object if file doesn't exist
   */
  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configFile, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, create empty config
        await this.createEmptyConfig();
        return {};
      } else {
        // Other errors (permission, invalid JSON, etc.)
        console.error(chalk.red(`❌ Error loading config: ${error.message}`));
        return {};
      }
    }
  }

  /**
   * Create an empty configuration file
   * @private
   */
  async createEmptyConfig() {
    const emptyConfig = {
      apiId: null,
      apiHash: null,
      phoneNumber: null
    };
    
    await Utils.handleAsyncOperation(
      async () => {
        await fs.writeFile(this.configFile, JSON.stringify(emptyConfig, null, 2));
        console.log(chalk.blue(`📄 Created config file: ${this.configFile}`));
      },
      'Error creating config file'
    );
  }

  /**
   * Save configuration to file
   * @param {Object} config - Configuration object to save
   * @returns {boolean} True if saved successfully
   */
  async saveConfig(config) {
    const success = await Utils.handleAsyncOperation(
      async () => {
        await fs.writeFile(this.configFile, JSON.stringify(config, null, 2));
        return true;
      },
      'Error saving config'
    );
    return success !== null;
  }

  /**
   * Check if configuration has required credentials
   * @param {Object} config - Configuration object
   * @returns {boolean} True if all required fields are present
   */
  hasValidCredentials(config) {
    return config && config.apiId && config.apiHash && config.phoneNumber;
  }
}

/**
 * Session management
 */
class SessionManager {
  constructor(sessionFile = CONFIG.SESSION_FILE) {
    this.sessionFile = sessionFile;
  }

  async loadSession() {
    try {
      const sessionData = await fs.readFile(this.sessionFile, 'utf8');
      return JSON.parse(sessionData).session;
    } catch {
      return '';
    }
  }

  async saveSession(client) {
    try {
      const session = client.session.save();
      await fs.writeFile(this.sessionFile, JSON.stringify({ session }));
    } catch (error) {
      console.warn(chalk.yellow('⚠️ Could not save session:'), error.message);
    }
  }
}

/**
 * Authentication handler
 */
class AuthHandler {
  constructor(sessionManager, configManager) {
    this.sessionManager = sessionManager;
    this.configManager = configManager;
  }

  /**
   * Prompt user for credentials with optional defaults
   * @param {Object} defaults - Default values for credentials
   * @returns {Object} User-entered credentials
   */
  async promptCredentials(defaults = {}) {
    return await inquirer.prompt([
      {
        type: 'input',
        name: 'apiId',
        message: 'Enter your Telegram API ID:',
        default: defaults.apiId,
        validate: input => Utils.validateCredential(input, 'API ID')
      },
      {
        type: 'input',
        name: 'apiHash',
        message: 'Enter your Telegram API Hash:',
        default: defaults.apiHash,
        validate: input => Utils.validateCredential(input, 'API Hash')
      },
      {
        type: 'input',
        name: 'phoneNumber',
        message: 'Enter your phone number (with country code):',
        default: defaults.phoneNumber,
        validate: input => Utils.validateCredential(input, 'Phone number')
      }
    ]);
  }

  /**
   * Ask user if they want to save credentials
   * @returns {boolean} True if user wants to save
   */
  async askSaveCredentials() {
    const { saveCredentials } = await inquirer.prompt([{
      type: 'confirm',
      name: 'saveCredentials',
      message: 'Would you like to save these credentials for future use?',
      default: true
    }]);
    return saveCredentials;
  }

  /**
   * Ask user if they want to update credentials
   * @returns {boolean} True if user wants to update
   */
  async askUpdateCredentials() {
    const { updateCredentials } = await inquirer.prompt([{
      type: 'confirm',
      name: 'updateCredentials',
      message: 'Would you like to update the saved credentials with these new values?',
      default: true
    }]);
    return updateCredentials;
  }

  /**
   * Get credentials from user with config management
   * @returns {Object} Final credentials to use
   */
  async getCredentials() {
    const savedConfig = await this.configManager.loadConfig();
    const hasValidDefaults = this.configManager.hasValidCredentials(savedConfig);

    // Get credentials from user
    const credentials = await this.promptCredentials(
      hasValidDefaults ? savedConfig : {}
    );

    // Handle config saving/updating
    const isFirstTime = !hasValidDefaults;
    const valuesChanged = hasValidDefaults && !Utils.credentialsEqual(credentials, savedConfig);

    if (isFirstTime) {
      if (await this.askSaveCredentials()) {
        const success = await this.configManager.saveConfig(credentials);
        if (success) {
          console.log(chalk.green('✅ Credentials saved!'));
        }
      }
    } else if (valuesChanged) {
      if (await this.askUpdateCredentials()) {
        const success = await this.configManager.saveConfig(credentials);
        if (success) {
          console.log(chalk.green('✅ Credentials updated!'));
        }
      }
    }

    return credentials;
  }

  async authenticateClient(credentials) {
    const stringSession = new StringSession(await this.sessionManager.loadSession());
    const client = new TelegramClient(stringSession, parseInt(credentials.apiId), credentials.apiHash, {
      connectionRetries: 5,
    });

    await client.start({
      phoneNumber: credentials.phoneNumber,
      password: async () => {
        const { password } = await inquirer.prompt([{
          type: 'password',
          name: 'password',
          message: 'Enter your 2FA password (if enabled):'
        }]);
        return password;
      },
      phoneCode: async () => {
        const { code } = await inquirer.prompt([{
          type: 'input',
          name: 'code',
          message: 'Enter the verification code sent to your phone:'
        }]);
        return code;
      },
      onError: (err) => console.error(chalk.red('Authentication error:'), err),
    });

    await this.sessionManager.saveSession(client);
    return client;
  }
}

/**
 * Group management operations
 */
class GroupManager {
  constructor(client) {
    this.client = client;
  }

  async getDialogs() {
    return await this.client.getDialogs({ limit: CONFIG.DIALOGS_LIMIT });
  }

  async getMyMessageCount(dialog) {
    try {
      const messages = await this.client.getMessages(dialog.entity, {
        fromUser: 'me',
        limit: CONFIG.MESSAGES_LIMIT
      });
      return messages.length;
    } catch (error) {
      console.log(chalk.red(`Error checking messages in ${dialog.title}: ${error.message}`));
      return 0;
    }
  }

  async getMyMessages(entity, limit = CONFIG.MESSAGES_LIMIT) {
    try {
      const messages = await this.client.getMessages(entity, {
        fromUser: 'me',
        limit: limit
      });
      
      return messages.map(msg => ({
        id: msg.id,
        text: msg.text || msg.message || '[Media/File]',
        date: new Date(msg.date * 1000).toLocaleString(),
        messageObj: msg
      }));
    } catch (error) {
      console.error(chalk.red('❌ Error fetching messages:'), error.message);
      return [];
    }
  }

  async deleteMessages(entity, messageIds) {
    try {
      await this.client.deleteMessages(entity, messageIds, { revoke: true });
      return true;
    } catch (error) {
      console.error(chalk.red('❌ Error deleting messages:'), error.message);
      return false;
    }
  }

  async getLastMessage(dialog) {
    try {
      const messages = await this.client.getMessages(dialog.entity, { limit: 1 });
      return messages.length > 0 ? messages[0] : null;
    } catch (error) {
      return null;
    }
  }

  async getUserRole(groupEntity) {
    try {
      const me = await this.client.getMe();
      const participants = await this.client.getParticipants(groupEntity);
      const myParticipant = participants.find(p => p.userId === me.id);

      if (!myParticipant) return 'member';

      const isOwner = myParticipant.className === 'ChannelParticipantCreator' || 
                     myParticipant.className === 'ChatParticipantCreator';
      const isAdmin = myParticipant.className === 'ChannelParticipantAdmin' || 
                     myParticipant.className === 'ChatParticipantAdmin';

      if (isOwner) return 'owner';
      if (isAdmin) return 'admin';
      return 'member';
    } catch (error) {
      console.error(chalk.red('❌ Error getting user role:'), error.message);
      return 'member';
    }
  }

  async leaveGroup(groupEntity) {
    await this.client.invoke({
      _: 'channels.leaveChannel',
      channel: groupEntity
    });
  }

  async deleteGroup(groupEntity) {
    const participants = await this.client.getParticipants(groupEntity);
    const me = await this.client.getMe();
    
    for (const participant of participants) {
      if (participant.userId !== me.id) {
        try {
          await this.client.invoke({
            _: 'channels.editBanned',
            channel: groupEntity,
            participant: participant,
            bannedRights: {
              _: 'chatBannedRights',
              viewMessages: true,
              sendMessages: true,
              sendMedia: true,
              sendStickers: true,
              sendGifs: true,
              sendGames: true,
              sendInline: true,
              embedLinks: true,
              untilDate: 0
            }
          });
        } catch (kickError) {
          console.warn(chalk.yellow(`⚠️ Could not kick user: ${kickError.message}`));
        }
      }
    }

    await this.client.invoke({
      _: 'channels.deleteChannel',
      channel: groupEntity
    });
  }
}

/**
 * UI components
 */
class UIComponents {
  static async showMainMenu() {
    const { feature } = await inquirer.prompt([{
      type: 'list',
      name: 'feature',
      message: 'Select a feature:',
      choices: [
        { name: '🗑️ Manage groups where I have posted messages', value: CONFIG.MENU_OPTIONS.MANAGE_POSTED },
        { name: '👥 Manage groups where I haven\'t posted messages', value: CONFIG.MENU_OPTIONS.MANAGE_INACTIVE },
        { name: chalk.gray('🚪 Exit'), value: CONFIG.MENU_OPTIONS.EXIT }
      ]
    }]);
    return feature;
  }

  static async showGroupActions(messageCount, groupTitle) {
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '🗑️ Delete all messages', value: CONFIG.GROUP_ACTIONS.DELETE_ALL },
        { name: '📄 Show full message list', value: CONFIG.GROUP_ACTIONS.SHOW_FULL },
        { name: '🔙 Go back', value: CONFIG.GROUP_ACTIONS.BACK }
      ]
    }]);
    return action;
  }

  static async confirmDeletion(messageCount, groupTitle) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: chalk.red(`Are you sure you want to delete all ${messageCount} messages from "${groupTitle}"?`),
      default: false
    }]);
    return confirm;
  }

  static async askLeaveGroup(groupTitle) {
    const { leaveGroup } = await inquirer.prompt([{
      type: 'confirm',
      name: 'leaveGroup',
      message: chalk.yellow(`Would you like to leave "${groupTitle}"?`),
      default: false
    }]);
    return leaveGroup;
  }

  static async confirmGroupDeletion(groupTitle) {
    const { deleteGroup } = await inquirer.prompt([{
      type: 'confirm',
      name: 'deleteGroup',
      message: chalk.red(`Would you like to kick all users and delete the group "${groupTitle}"?`),
      default: false
    }]);
    return deleteGroup;
  }

  static async confirmAdminLeave(groupTitle) {
    const { stillLeave } = await inquirer.prompt([{
      type: 'confirm',
      name: 'stillLeave',
      message: chalk.yellow(`Are you sure you want to leave "${groupTitle}"? You will lose admin privileges.`),
      default: false
    }]);
    return stillLeave;
  }

  static displayMessages(messages) {
    console.log(chalk.green(`\n📋 Found ${messages.length} of your messages:`));
    messages.forEach((msg, index) => {
      const preview = Utils.formatMessagePreview(msg.text);
      console.log(chalk.gray(`${index + 1}. [${msg.date}] ${preview}`));
    });
  }

  static displayFullMessages(messages) {
    console.log(chalk.blue('\n📋 Full message list:'));
    messages.forEach((msg, index) => {
      console.log(chalk.gray(`\n${index + 1}. [${msg.date}]`));
      console.log(chalk.white(msg.text));
      console.log(chalk.gray('─'.repeat(50)));
    });
  }
}

/**
 * Main application class
 */
class TelegramCleaner {
  constructor() {
    this.client = null;
    this.sessionManager = new SessionManager();
    this.configManager = new ConfigManager();
    this.authHandler = new AuthHandler(this.sessionManager, this.configManager);
    this.groupManager = null;
  }

  async authenticate() {
    console.log(chalk.blue('🔐 Telegram Authentication'));
    
    const credentials = await this.authHandler.getCredentials();
    
    try {
      this.client = await this.authHandler.authenticateClient(credentials);
      this.groupManager = new GroupManager(this.client);
      console.log(chalk.green('✅ Successfully authenticated!'));
    } catch (error) {
      console.error(chalk.red('❌ Authentication failed:'), error.message);
      process.exit(1);
    }
  }

  async getGroupsWithMyMessages() {
    console.log(chalk.blue('🔍 Scanning for groups where you have posted messages...'));
    
    const groupsWithMessages = [];
    const dialogs = await this.groupManager.getDialogs();
    
    for (const dialog of dialogs) {
      if (dialog.isGroup || dialog.isChannel) {
        const messageCount = await Utils.handleAsyncOperation(
          () => this.groupManager.getMyMessageCount(dialog),
          `Error checking messages in ${dialog.title}`
        );
        
        if (messageCount > 0) {
          groupsWithMessages.push({
            id: dialog.id,
            title: dialog.title,
            type: dialog.isChannel ? 'Channel' : 'Group',
            messageCount: messageCount,
            entity: dialog.entity
          });
        }
      }
    }

    return groupsWithMessages;
  }

  async getGroupsWithoutMyMessages() {
    console.log(chalk.blue('🔍 Scanning for groups where you haven\'t posted messages...'));
    
    const inactiveGroups = [];
    const dialogs = await this.groupManager.getDialogs();
    
    for (const dialog of dialogs) {
      if (dialog.isGroup || dialog.isChannel) {
        const messageCount = await Utils.handleAsyncOperation(
          () => this.groupManager.getMyMessageCount(dialog),
          `Error checking messages in ${dialog.title}`
        );
        
        if (messageCount === 0) {
          const lastMessage = await this.groupManager.getLastMessage(dialog);
          
          inactiveGroups.push({
            id: dialog.id,
            title: dialog.title,
            type: dialog.isChannel ? 'Channel' : 'Group',
            entity: dialog.entity,
            lastMessageDate: lastMessage ? lastMessage.date : 0
          });
        }
      }
    }

    const groups = inactiveGroups.filter(g => g.type === 'Group');
    const channels = inactiveGroups.filter(g => g.type === 'Channel');

    groups.sort((a, b) => a.lastMessageDate - b.lastMessageDate);
    channels.sort((a, b) => a.lastMessageDate - b.lastMessageDate);

    return { groups, channels };
  }

  async selectGroup(groups) {
    const groupsWithMessages = groups.filter(group => group.messageCount > 0);
    
    if (groupsWithMessages.length === 0) {
      console.log(chalk.yellow('📭 No groups found where you have posted messages.'));
      return null;
    }

    groupsWithMessages.sort((a, b) => a.messageCount - b.messageCount);

    const choices = groupsWithMessages.map(group => ({
      name: `${group.title} (${group.type}) - ${group.messageCount} messages`,
      value: group
    }));

    choices.push({ name: chalk.gray('🔙 Back to main menu'), value: null });

    const { selectedGroup } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedGroup',
      message: 'Select a group to manage your messages:',
      choices: choices,
      pageSize: 15
    }]);

    return selectedGroup;
  }

  async selectInactiveGroup(groups, channels) {
    const totalCount = groups.length + channels.length;
    
    if (totalCount === 0) {
      console.log(chalk.yellow('📭 No inactive groups found.'));
      return null;
    }

    const choices = [];

    if (groups.length > 0) {
      choices.push({ name: chalk.bold.green('--- GROUPS ---'), value: 'separator', disabled: true });
      groups.forEach(group => {
        const lastActivity = Utils.formatDate(group.lastMessageDate);
        choices.push({
          name: `${group.title} (Last activity: ${lastActivity})`,
          value: group
        });
      });
    }

    if (channels.length > 0) {
      choices.push({ name: chalk.bold.blue('--- CHANNELS ---'), value: 'separator', disabled: true });
      channels.forEach(channel => {
        const lastActivity = Utils.formatDate(channel.lastMessageDate);
        choices.push({
          name: `${channel.title} (Last activity: ${lastActivity})`,
          value: channel
        });
      });
    }

    choices.push({ name: chalk.gray('🔙 Back to main menu'), value: null });

    const { selectedGroup } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedGroup',
      message: `Select a group to manage (${totalCount} inactive groups):`,
      choices: choices,
      pageSize: 15
    }]);

    return selectedGroup;
  }

  async manageGroupMessages(group) {
    console.log(chalk.blue(`\n📱 Managing messages in: ${group.title}`));
    
    const messages = await this.groupManager.getMyMessages(group.entity);

    if (messages.length === 0) {
      console.log(chalk.yellow('📭 No messages found in this group.'));
      return;
    }

    UIComponents.displayMessages(messages);

    const action = await UIComponents.showGroupActions(messages.length, group.title);

    if (action === CONFIG.GROUP_ACTIONS.DELETE_ALL) {
      await this.handleMessageDeletion(group, messages);
    } else if (action === CONFIG.GROUP_ACTIONS.SHOW_FULL) {
      await this.handleFullMessageDisplay(group, messages);
    }
  }

  async handleMessageDeletion(group, messages) {
    const confirm = await UIComponents.confirmDeletion(messages.length, group.title);

    if (confirm) {
      console.log(chalk.blue('🗑️ Deleting messages...'));
      const messageIds = messages.map(msg => msg.messageObj.id);
      const success = await this.groupManager.deleteMessages(group.entity, messageIds);
      
      if (success) {
        console.log(chalk.green(`✅ Successfully deleted ${messages.length} messages!`));
        await this.handlePostDeletion(group);
      } else {
        console.log(chalk.red('❌ Failed to delete some messages.'));
      }
    }
  }

  async handleFullMessageDisplay(group, messages) {
    UIComponents.displayFullMessages(messages);

    const deleteAfterShow = await UIComponents.confirmDeletion(messages.length, group.title);

    if (deleteAfterShow) {
      console.log(chalk.blue('🗑️ Deleting messages...'));
      const messageIds = messages.map(msg => msg.messageObj.id);
      const success = await this.groupManager.deleteMessages(group.entity, messageIds);
      
      if (success) {
        console.log(chalk.green(`✅ Successfully deleted ${messages.length} messages!`));
        await this.handlePostDeletion(group);
      } else {
        console.log(chalk.red('❌ Failed to delete some messages.'));
      }
    }
  }

  async handlePostDeletion(group) {
    const leaveGroup = await UIComponents.askLeaveGroup(group.title);

    if (leaveGroup) {
      const userRole = await this.groupManager.getUserRole(group.entity);
      
      try {
        if (userRole === 'owner') {
          console.log(chalk.red(`⚠️ You are the owner of "${group.title}"`));
          const deleteGroup = await UIComponents.confirmGroupDeletion(group.title);

          if (deleteGroup) {
            console.log(chalk.blue('🚫 Kicking all users and deleting group...'));
            await this.groupManager.deleteGroup(group.entity);
            console.log(chalk.green(`✅ Successfully deleted "${group.title}"`));
          } else {
            console.log(chalk.blue('👋 Leaving group...'));
            await this.groupManager.leaveGroup(group.entity);
            console.log(chalk.green(`✅ Left "${group.title}"`));
          }
        } else if (userRole === 'admin') {
          console.log(chalk.yellow(`⚠️ You are an administrator of "${group.title}"`));
          const stillLeave = await UIComponents.confirmAdminLeave(group.title);

          if (stillLeave) {
            console.log(chalk.blue('👋 Leaving group...'));
            await this.groupManager.leaveGroup(group.entity);
            console.log(chalk.green(`✅ Left "${group.title}"`));
          }
        } else {
          console.log(chalk.blue('👋 Leaving group...'));
          await this.groupManager.leaveGroup(group.entity);
          console.log(chalk.green(`✅ Left "${group.title}"`));
        }
      } catch (error) {
        console.error(chalk.red('❌ Error leaving group:'), error.message);
      }
    }
  }

  async handleInactiveGroup(group) {
    console.log(chalk.blue(`\n📱 Managing inactive group: ${group.title} (${group.type})`));
    
    const leaveGroup = await UIComponents.askLeaveGroup(group.title);

    if (leaveGroup) {
      await this.handlePostDeletion(group);
    }
  }

  async managePostedMessages() {
    while (true) {
      const groups = await this.getGroupsWithMyMessages();
      const selectedGroup = await this.selectGroup(groups);

      if (!selectedGroup) {
        break;
      }

      await this.manageGroupMessages(selectedGroup);
    }
  }

  async manageInactiveGroups() {
    while (true) {
      const { groups, channels } = await this.getGroupsWithoutMyMessages();
      const selectedGroup = await this.selectInactiveGroup(groups, channels);

      if (!selectedGroup) {
        break;
      }

      await this.handleInactiveGroup(selectedGroup);
    }
  }

  async run() {
    console.log(chalk.bold.blue('🧹 Telegram Message Cleaner\n'));

    await this.authenticate();

    while (true) {
      const feature = await UIComponents.showMainMenu();

      if (feature === CONFIG.MENU_OPTIONS.EXIT) {
        console.log(chalk.blue('👋 Goodbye!'));
        break;
      } else if (feature === CONFIG.MENU_OPTIONS.MANAGE_POSTED) {
        await this.managePostedMessages();
      } else if (feature === CONFIG.MENU_OPTIONS.MANAGE_INACTIVE) {
        await this.manageInactiveGroups();
      }
    }

    if (this.client) {
      await this.client.disconnect();
    }
  }
}

const cleaner = new TelegramCleaner();
cleaner.run().catch(error => {
  console.error(chalk.red('💥 Fatal error:'), error);
  process.exit(1);
});