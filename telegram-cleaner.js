#!/usr/bin/env node

import pkg from 'telegram';
const { TelegramClient } = pkg;
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram/tl/index.js';
import inquirer from 'inquirer';
import autocomplete from 'inquirer-autocomplete-prompt';
import chalk from 'chalk';
import fs from 'fs/promises';

inquirer.registerPrompt('autocomplete', autocomplete);

/**
 * Application configuration
 */
const CONFIG = {
  DEFAULT_DIALOGS_LIMIT: 2000,
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
  },
  SPECIAL_VALUES: {
    RELOAD: 'reload',
    SEPARATOR: 'separator',
    BACK: null
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

  static createAutocompleteSource(choices) {
    return (answers, input) => {
      if (!input || input === '') {
        return Promise.resolve(choices);
      }
      
      const filtered = choices.filter(choice => {
        if (choice.value === CONFIG.SPECIAL_VALUES.BACK || 
            choice.value === CONFIG.SPECIAL_VALUES.RELOAD) return true;
        if (choice.disabled) return true;
        return choice.name.toLowerCase().includes(input.toLowerCase());
      });
      
      return Promise.resolve(filtered);
    };
  }
}

/**
 * Configuration management
 */
class ConfigManager {
  constructor(configFile = CONFIG.CONFIG_FILE) {
    this.configFile = configFile;
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configFile, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await this.createEmptyConfig();
        return {};
      } else {
        console.error(chalk.red(`❌ Error loading config: ${error.message}`));
        return {};
      }
    }
  }

  async createEmptyConfig() {
    const emptyConfig = {
      apiId: null,
      apiHash: null,
      phoneNumber: null,
      dialogsLimit: CONFIG.DEFAULT_DIALOGS_LIMIT
    };
    
    await Utils.handleAsyncOperation(
      async () => {
        await fs.writeFile(this.configFile, JSON.stringify(emptyConfig, null, 2));
        console.log(chalk.blue(`📄 Created config file: ${this.configFile}`));
      },
      'Error creating config file'
    );
  }

  async saveConfig(config) {
    if (!config.dialogsLimit) {
      config.dialogsLimit = CONFIG.DEFAULT_DIALOGS_LIMIT;
    }
    
    const success = await Utils.handleAsyncOperation(
      async () => {
        await fs.writeFile(this.configFile, JSON.stringify(config, null, 2));
        return true;
      },
      'Error saving config'
    );
    return success !== null;
  }

  hasValidCredentials(config) {
    return config && config.apiId && config.apiHash && config.phoneNumber;
  }

  getDialogsLimit(config) {
    return config && config.dialogsLimit ? config.dialogsLimit : CONFIG.DEFAULT_DIALOGS_LIMIT;
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

  async askSaveCredentials() {
    const { saveCredentials } = await inquirer.prompt([{
      type: 'confirm',
      name: 'saveCredentials',
      message: 'Would you like to save these credentials for future use?',
      default: true
    }]);
    return saveCredentials;
  }

  async askUpdateCredentials() {
    const { updateCredentials } = await inquirer.prompt([{
      type: 'confirm',
      name: 'updateCredentials',
      message: 'Would you like to update the saved credentials with these new values?',
      default: true
    }]);
    return updateCredentials;
  }

  async getCredentials() {
    const savedConfig = await this.configManager.loadConfig();
    const hasValidDefaults = this.configManager.hasValidCredentials(savedConfig);

    const credentials = await this.promptCredentials(
      hasValidDefaults ? savedConfig : {}
    );

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

  async getDialogs(limit) {
    return await this.client.getDialogs({ limit: limit || CONFIG.DEFAULT_DIALOGS_LIMIT });
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
      // If we can't get participants (common for channels), assume member role
      if (error.message.includes('CHAT_ADMIN_REQUIRED') || 
          error.message.includes('CHANNEL_PRIVATE') ||
          error.message.includes('FORBIDDEN')) {
        return 'member';
      }
      console.error(chalk.red('❌ Error getting user role:'), error.message);
      return 'member';
    }
  }

  async leaveGroup(groupEntity) {
    try {
      // Use the high-level client method first (most reliable)
      await this.client.leaveChat(groupEntity);
    } catch (error) {
      // Fallback to manual MTProto methods
      try {
        if (groupEntity.className === 'Channel') {
          await this.client.invoke(
            new Api.channels.LeaveChannel({
              channel: groupEntity
            })
          );
        } else {
          // For regular groups
          const me = await this.client.getMe();
          await this.client.invoke(
            new Api.messages.DeleteChatUser({
              chatId: groupEntity.id,
              userId: me.id
            })
          );
        }
      } catch (fallbackError) {
        // Final fallback: try LeaveChannel for any group type
        try {
          await this.client.invoke(
            new Api.channels.LeaveChannel({
              channel: groupEntity
            })
          );
        } catch (finalError) {
          throw new Error(`Failed to leave group: ${error.message}. Tried multiple methods.`);
        }
      }
    }
  }

  async deleteGroup(groupEntity) {
    try {
      const participants = await this.client.getParticipants(groupEntity);
      const me = await this.client.getMe();
      
      // Step 1: Delete all messages from all users
      console.log(chalk.blue('🗑️ Deleting all messages...'));
      let messagesDeleted = false;
      try {
        // Get all messages in the group and delete them
        let totalDeleted = 0;
        let offsetId = 0;
        
        while (true) {
          const messages = await this.client.getMessages(groupEntity, {
            limit: 100,
            offsetId: offsetId
          });
          
          if (messages.length === 0) break;
          
          const messageIds = messages.map(msg => msg.id);
          
          try {
            await this.client.deleteMessages(groupEntity, messageIds, { revoke: true });
            totalDeleted += messageIds.length;
          } catch (deleteError) {
            console.warn(chalk.yellow(`⚠️ Could not delete some messages: ${deleteError.message}`));
          }
          
          offsetId = messages[messages.length - 1].id;
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        if (totalDeleted > 0) {
          console.log(chalk.green(`✅ Messages deleted: ${totalDeleted}`));
          messagesDeleted = true;
        } else {
          console.log(chalk.yellow(`⚠️ No messages to delete`));
        }
      } catch (error) {
        console.log(chalk.red(`❌ Messages deletion failed: ${error.message}`));
      }
      
      // Step 2: Kick all members except yourself
      console.log(chalk.blue('🚫 Kicking all members...'));
      let kickedCount = 0;
      let membersKicked = false;
      
      for (const participant of participants) {
        if (participant.userId !== me.id) {
          try {
            await this.client.invoke(
              new Api.channels.EditBanned({
                channel: groupEntity,
                participant: participant,
                bannedRights: new Api.ChatBannedRights({
                  viewMessages: true,
                  sendMessages: true,
                  sendMedia: true,
                  sendStickers: true,
                  sendGifs: true,
                  sendGames: true,
                  sendInline: true,
                  embedLinks: true,
                  untilDate: 0
                })
              })
            );
            kickedCount++;
          } catch (kickError) {
            console.warn(chalk.yellow(`⚠️ Could not kick user: ${kickError.message}`));
          }
        }
      }
      
      if (kickedCount > 0) {
        console.log(chalk.green(`✅ Members kicked: ${kickedCount}`));
        membersKicked = true;
      } else {
        console.log(chalk.yellow(`⚠️ No members to kick`));
      }

      // Step 3: Delete the group
      console.log(chalk.blue('🗑️ Deleting the group...'));
      let groupDeleted = false;
      try {
        await this.client.invoke(
          new Api.channels.DeleteChannel({
            channel: groupEntity
          })
        );
        console.log(chalk.green(`✅ Group deleted successfully`));
        groupDeleted = true;
      } catch (error) {
        console.log(chalk.red(`❌ Group deletion failed: ${error.message}`));
      }
    } catch (error) {
      console.error(chalk.red(`❌ Error during group deletion: ${error.message}`));
      throw error;
    }
  }
}

/**
 * Data management for groups
 */
class GroupDataManager {
  constructor(groupManager, configManager) {
    this.groupManager = groupManager;
    this.configManager = configManager;
    this.cachedGroupsWithMessages = null;
    this.cachedInactiveGroups = null;
    this.processedGroups = new Set();
  }

  async loadGroupsWithMessages(forceReload = false) {
    if (this.cachedGroupsWithMessages && !forceReload) {
      return this.cachedGroupsWithMessages;
    }
    
    console.log(chalk.blue('🔍 Scanning for groups where you have posted messages...'));
    
    const config = await this.configManager.loadConfig();
    const dialogsLimit = this.configManager.getDialogsLimit(config);
    
    const groupsWithMessages = [];
    const dialogs = await this.groupManager.getDialogs(dialogsLimit);
    
    for (const dialog of dialogs) {
      if (dialog.isGroup || dialog.isChannel) {
        const messageCount = await Utils.handleAsyncOperation(
          () => this.groupManager.getMyMessageCount(dialog),
          `Error checking messages in ${dialog.title}`
        );
        
        if (messageCount > 0) {
          const lastMessage = await this.groupManager.getLastMessage(dialog);
          
          groupsWithMessages.push({
            id: dialog.id,
            title: dialog.title,
            type: dialog.isChannel ? 'Channel' : 'Group',
            messageCount: messageCount,
            entity: dialog.entity,
            lastMessageDate: lastMessage ? lastMessage.date : 0
          });
        }
      }
    }

    this.cachedGroupsWithMessages = groupsWithMessages;
    if (forceReload) {
      this.processedGroups.clear();
    }
    
    return groupsWithMessages;
  }

  async loadInactiveGroups(forceReload = false) {
    if (this.cachedInactiveGroups && !forceReload) {
      return this.cachedInactiveGroups;
    }
    
    console.log(chalk.blue('🔍 Scanning for groups where you haven\'t posted messages...'));
    
    const config = await this.configManager.loadConfig();
    const dialogsLimit = this.configManager.getDialogsLimit(config);
    
    const inactiveGroups = [];
    const dialogs = await this.groupManager.getDialogs(dialogsLimit);
    
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

    const result = { groups, channels };
    this.cachedInactiveGroups = result;
    if (forceReload) {
      this.processedGroups.clear();
    }
    
    return result;
  }

  markGroupAsProcessed(groupId) {
    this.processedGroups.add(groupId);
  }

  isGroupProcessed(groupId) {
    return this.processedGroups.has(groupId);
  }

  clearProcessedGroups() {
    this.processedGroups.clear();
  }
}

/**
 * UI components and interactions
 */
class UIManager {
  constructor(groupDataManager) {
    this.groupDataManager = groupDataManager;
  }

  async showMainMenu() {
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

  formatGroupChoice(group, includeMessageCount = false) {
    const lastActivity = Utils.formatDate(group.lastMessageDate);
    const isProcessed = this.groupDataManager.isGroupProcessed(group.id);
    const processedMarker = isProcessed ? chalk.green(' [PROCESSED]') : '';
    
    let displayText;
    if (includeMessageCount) {
      displayText = `${group.title} (${group.type}) - ${group.messageCount} messages (Last: ${lastActivity})`;
    } else {
      displayText = `${group.title} (Last activity: ${lastActivity})`;
    }
    
    const displayName = isProcessed 
      ? chalk.gray(`${displayText}${processedMarker}`)
      : displayText;
    
    return {
      name: displayName,
      value: group
    };
  }

  async selectGroupWithMessages(groups) {
    const groupsWithMessages = groups.filter(group => group.messageCount > 0);
    
    if (groupsWithMessages.length === 0) {
      console.log(chalk.yellow('📭 No groups found where you have posted messages.'));
      return null;
    }

    groupsWithMessages.sort((a, b) => a.lastMessageDate - b.lastMessageDate);

    const choices = groupsWithMessages.map(group => 
      this.formatGroupChoice(group, true)
    );

    choices.unshift({ name: chalk.blue('🔄 Reload group list'), value: CONFIG.SPECIAL_VALUES.RELOAD });
    choices.push({ name: chalk.gray('🔙 Back to main menu'), value: CONFIG.SPECIAL_VALUES.BACK });

    const { selectedGroup } = await inquirer.prompt([{
      type: 'autocomplete',
      name: 'selectedGroup',
      message: 'Select a group to manage your messages (type to search):',
      source: Utils.createAutocompleteSource(choices),
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
    choices.push({ name: chalk.blue('🔄 Reload group list'), value: CONFIG.SPECIAL_VALUES.RELOAD });

    if (groups.length > 0) {
      choices.push({ name: chalk.bold.green('--- GROUPS ---'), value: CONFIG.SPECIAL_VALUES.SEPARATOR, disabled: true });
      groups.forEach(group => {
        choices.push(this.formatGroupChoice(group, false));
      });
    }

    if (channels.length > 0) {
      choices.push({ name: chalk.bold.blue('--- CHANNELS ---'), value: CONFIG.SPECIAL_VALUES.SEPARATOR, disabled: true });
      channels.forEach(channel => {
        choices.push(this.formatGroupChoice(channel, false));
      });
    }

    choices.push({ name: chalk.gray('🔙 Back to main menu'), value: CONFIG.SPECIAL_VALUES.BACK });

    const { selectedGroup } = await inquirer.prompt([{
      type: 'autocomplete',
      name: 'selectedGroup',
      message: `Select a group to manage (${totalCount} inactive groups, type to search):`,
      source: Utils.createAutocompleteSource(choices),
      pageSize: 15
    }]);

    return selectedGroup;
  }

  async showGroupActions(messageCount, groupTitle) {
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

  async confirmDeletion(messageCount, groupTitle) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: chalk.red(`Are you sure you want to delete all ${messageCount} messages from "${groupTitle}"?`),
      default: false
    }]);
    return confirm;
  }

  async askLeaveGroup(groupTitle) {
    const { leaveGroup } = await inquirer.prompt([{
      type: 'confirm',
      name: 'leaveGroup',
      message: chalk.yellow(`Would you like to leave "${groupTitle}"?`),
      default: false
    }]);
    return leaveGroup;
  }

  async confirmGroupDeletion(groupTitle) {
    const { deleteGroup } = await inquirer.prompt([{
      type: 'confirm',
      name: 'deleteGroup',
      message: chalk.red(`Would you like to delete ALL messages, kick all users, and delete the group "${groupTitle}"?`),
      default: false
    }]);
    return deleteGroup;
  }

  async confirmAdminLeave(groupTitle) {
    const { stillLeave } = await inquirer.prompt([{
      type: 'confirm',
      name: 'stillLeave',
      message: chalk.yellow(`Are you sure you want to leave "${groupTitle}"? You will lose admin privileges.`),
      default: false
    }]);
    return stillLeave;
  }

  displayMessages(messages) {
    console.log(chalk.green(`\n📋 Found ${messages.length} of your messages:`));
    messages.forEach((msg, index) => {
      const preview = Utils.formatMessagePreview(msg.text);
      console.log(chalk.gray(`${index + 1}. [${msg.date}] ${preview}`));
    });
  }

  displayFullMessages(messages) {
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
    this.groupDataManager = null;
    this.uiManager = null;
  }

  async authenticate() {
    console.log(chalk.blue('🔐 Telegram Authentication'));
    
    const credentials = await this.authHandler.getCredentials();
    
    try {
      this.client = await this.authHandler.authenticateClient(credentials);
      this.groupManager = new GroupManager(this.client);
      this.groupDataManager = new GroupDataManager(this.groupManager, this.configManager);
      this.uiManager = new UIManager(this.groupDataManager);
      console.log(chalk.green('✅ Successfully authenticated!'));
    } catch (error) {
      console.error(chalk.red('❌ Authentication failed:'), error.message);
      process.exit(1);
    }
  }

  async handleLeaveGroup(group) {
    const userRole = await this.groupManager.getUserRole(group.entity);
    
    try {
      if (userRole === 'owner') {
        console.log(chalk.red(`⚠️ You are the owner of "${group.title}"`));
        console.log(chalk.blue('🗑️ Deleting all messages, kicking all users, and deleting group...'));
        await this.groupManager.deleteGroup(group.entity);
        console.log(chalk.green(`✅ Successfully completely deleted "${group.title}"`));
      } else if (userRole === 'admin') {
        console.log(chalk.yellow(`⚠️ You are an administrator of "${group.title}"`));
        const stillLeave = await this.uiManager.confirmAdminLeave(group.title);

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

  async handlePostDeletion(group) {
    const leaveGroup = await this.uiManager.askLeaveGroup(group.title);

    if (leaveGroup) {
      await this.handleLeaveGroup(group);
    }
    
    this.groupDataManager.markGroupAsProcessed(group.id);
  }

  async handleInactiveGroup(group) {
    const userRole = await this.groupManager.getUserRole(group.entity);
    console.log(chalk.blue(`\n📱 Managing inactive group: ${group.title} (${group.type}) ${chalk.cyan(`[${userRole.toUpperCase()}]`)}`));
    
    const leaveGroup = await this.uiManager.askLeaveGroup(group.title);

    if (leaveGroup) {
      await this.handleLeaveGroup(group);
    }
    
    this.groupDataManager.markGroupAsProcessed(group.id);
  }

  async handleMessageDeletion(group, messages) {
    const confirm = await this.uiManager.confirmDeletion(messages.length, group.title);

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
    this.uiManager.displayFullMessages(messages);

    const deleteAfterShow = await this.uiManager.confirmDeletion(messages.length, group.title);

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

  async manageGroupMessages(group) {
    const userRole = await this.groupManager.getUserRole(group.entity);
    console.log(chalk.blue(`\n📱 Managing messages in: ${group.title} ${chalk.cyan(`[${userRole.toUpperCase()}]`)}`));
    
    const messages = await this.groupManager.getMyMessages(group.entity);

    if (messages.length === 0) {
      console.log(chalk.yellow('📭 No messages found in this group.'));
      this.groupDataManager.markGroupAsProcessed(group.id);
      return;
    }

    this.uiManager.displayMessages(messages);

    const action = await this.uiManager.showGroupActions(messages.length, group.title);

    if (action === CONFIG.GROUP_ACTIONS.DELETE_ALL) {
      await this.handleMessageDeletion(group, messages);
    } else if (action === CONFIG.GROUP_ACTIONS.SHOW_FULL) {
      await this.handleFullMessageDisplay(group, messages);
    } else if (action === CONFIG.GROUP_ACTIONS.BACK) {
      this.groupDataManager.markGroupAsProcessed(group.id);
    }
  }

  async managePostedMessages() {
    while (true) {
      const groups = await this.groupDataManager.loadGroupsWithMessages();
      const selectedGroup = await this.uiManager.selectGroupWithMessages(groups);

      if (!selectedGroup) {
        break;
      }

      if (selectedGroup === CONFIG.SPECIAL_VALUES.RELOAD) {
        console.log(chalk.blue('🔄 Reloading group list...'));
        await this.groupDataManager.loadGroupsWithMessages(true);
        continue;
      }

      await this.manageGroupMessages(selectedGroup);
    }
  }

  async manageInactiveGroups() {
    while (true) {
      const { groups, channels } = await this.groupDataManager.loadInactiveGroups();
      const selectedGroup = await this.uiManager.selectInactiveGroup(groups, channels);

      if (!selectedGroup) {
        break;
      }

      if (selectedGroup === CONFIG.SPECIAL_VALUES.RELOAD) {
        console.log(chalk.blue('🔄 Reloading group list...'));
        await this.groupDataManager.loadInactiveGroups(true);
        continue;
      }

      await this.handleInactiveGroup(selectedGroup);
    }
  }

  async run() {
    console.log(chalk.bold.blue('🧹 Telegram Message Cleaner\n'));

    await this.authenticate();

    while (true) {
      const feature = await this.uiManager.showMainMenu();

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