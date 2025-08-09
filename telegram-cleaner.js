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
  PARTICIPANTS_LIMIT: 16,
  DISPLAY_MEMBERS_LIMIT: 15,
  MESSAGE_PREVIEW_LENGTH: 50,
  RATE_LIMIT_DELAY: 500,
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
  },
  USER_ROLES: {
    OWNER: 'owner',
    ADMIN: 'admin',
    MEMBER: 'member'
  },
  ROLE_CLASSES: {
    CHANNEL_CREATOR: 'ChannelParticipantCreator',
    CHAT_CREATOR: 'ChatParticipantCreator',
    CHANNEL_ADMIN: 'ChannelParticipantAdmin',
    CHAT_ADMIN: 'ChatParticipantAdmin'
  },
  ERROR_MESSAGES: {
    ADMIN_REQUIRED: 'CHAT_ADMIN_REQUIRED',
    CHANNEL_PRIVATE: 'CHANNEL_PRIVATE',
    FORBIDDEN: 'FORBIDDEN'
  }
};

/**
 * Utility functions for common operations
 */
class Utils {
  static formatDate(timestamp) {
    return timestamp ? new Date(timestamp * 1000).toLocaleDateString() : 'No activity';
  }

  static formatMessagePreview(text, maxLength = CONFIG.MESSAGE_PREVIEW_LENGTH) {
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
 * Role management for users and participants
 * Handles role detection, formatting, and role-based logic
 */
class RoleManager {
  /**
   * Determines user role from participant object
   * @param {Object} participant - Telegram participant object
   * @returns {string} Role: 'owner', 'admin', or 'member'
   */
  static getUserRoleFromParticipant(participant) {
    if (!participant) return CONFIG.USER_ROLES.MEMBER;
    
    // Check multiple possible className fields
    const className = participant.className || participant.constructor?.name || participant._?.className;
    
    // Also check for specific Telegram MTProto class names
    if (className === CONFIG.ROLE_CLASSES.CHANNEL_CREATOR || 
        className === CONFIG.ROLE_CLASSES.CHAT_CREATOR ||
        className === 'ChannelParticipantCreator' ||
        className === 'ChatParticipantCreator') {
      return CONFIG.USER_ROLES.OWNER;
    }
    
    if (className === CONFIG.ROLE_CLASSES.CHANNEL_ADMIN || 
        className === CONFIG.ROLE_CLASSES.CHAT_ADMIN ||
        className === 'ChannelParticipantAdmin' ||
        className === 'ChatParticipantAdmin') {
      return CONFIG.USER_ROLES.ADMIN;
    }
    
    // Additional check for type field that Telegram API sometimes uses
    if (participant.type) {
      if (participant.type === 'creator' || participant.type === 'owner') {
        return CONFIG.USER_ROLES.OWNER;
      }
      if (participant.type === 'admin' || participant.type === 'administrator') {
        return CONFIG.USER_ROLES.ADMIN;
      }
    }
    
    return CONFIG.USER_ROLES.MEMBER;
  }

  /**
   * Formats user display name with role badge
   * @param {Object} user - User object with name properties
   * @param {string} role - User role
   * @returns {string} Formatted display name with colored role badge
   */
  static formatUserDisplayName(user, role = CONFIG.USER_ROLES.MEMBER) {
    let displayName = user.firstName || '';
    if (user.lastName) displayName += ` ${user.lastName}`;
    if (user.username) displayName += ` (@${user.username})`;
    if (!displayName.trim()) displayName = `User ${user.id}`;
    
    const roleDisplay = this.getRoleDisplay(role);
    return `${displayName} ${roleDisplay}`;
  }

  static getRoleDisplay(role) {
    switch (role) {
      case CONFIG.USER_ROLES.OWNER:
        return chalk.red('[OWNER]');
      case CONFIG.USER_ROLES.ADMIN:
        return chalk.yellow('[ADMIN]');
      case CONFIG.USER_ROLES.MEMBER:
        return chalk.gray('[MEMBER]');
      default:
        return chalk.gray('[MEMBER]');
    }
  }

  static isOwner(role) {
    return role === CONFIG.USER_ROLES.OWNER;
  }

  static isAdmin(role) {
    return role === CONFIG.USER_ROLES.ADMIN;
  }

  static isMember(role) {
    return role === CONFIG.USER_ROLES.MEMBER;
  }
}

/**
 * Centralized logging utilities with consistent formatting
 * Provides color-coded logging methods for different message types
 */
class Logger {
  static success(message) {
    console.log(chalk.green(`✅ ${message}`));
  }

  static error(message, error = null) {
    const errorText = error ? `: ${error.message || error}` : '';
    console.error(chalk.red(`❌ ${message}${errorText}`));
  }

  static warning(message) {
    console.log(chalk.yellow(`⚠️ ${message}`));
  }

  static info(message) {
    console.log(chalk.blue(`ℹ️ ${message}`));
  }

  static progress(message) {
    console.log(chalk.blue(`🔄 ${message}`));
  }

  static action(message) {
    console.log(chalk.blue(`🗑️ ${message}`));
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
        Logger.info(`Created config file: ${this.configFile}`);
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
          Logger.success('Credentials saved!');
        }
      }
    } else if (valuesChanged) {
      if (await this.askUpdateCredentials()) {
        const success = await this.configManager.saveConfig(credentials);
        if (success) {
          Logger.success('Credentials updated!');
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
 * Handles Telegram API interactions for groups, messages, and participants
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

  async getParticipants(groupEntity, limit = null) {
    try {
      const options = limit ? { limit } : {};
      return await this.client.getParticipants(groupEntity, options);
    } catch (error) {
      if (error.message.includes(CONFIG.ERROR_MESSAGES.ADMIN_REQUIRED) || 
          error.message.includes(CONFIG.ERROR_MESSAGES.CHANNEL_PRIVATE) ||
          error.message.includes(CONFIG.ERROR_MESSAGES.FORBIDDEN)) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Gets participants with their role information
   * @param {Object} groupEntity - Telegram group entity
   * @param {number} limit - Optional limit
   * @returns {Promise<Array>} Array of participants with role info
   */
  async getParticipantsWithRoles(groupEntity, limit = null) {
    try {
      const isChannel = groupEntity.className === 'Channel';
      
      if (isChannel) {
        // For channels/supergroups, use getParticipants which should return role info
        const options = limit ? { limit } : {};
        return await this.client.getParticipants(groupEntity, options);
      } else {
        // For regular chats, use GetFullChat to get participant objects with roles
        try {
          const chatFull = await this.client.invoke(
            new Api.messages.GetFullChat({
              chatId: groupEntity.id
            })
          );
          
          if (chatFull.fullChat && chatFull.fullChat.participants) {
            const participants = chatFull.fullChat.participants.participants || [];
            const users = chatFull.users || [];
            
            // Create a user lookup map
            const userMap = new Map();
            users.forEach(user => {
              const userId = typeof user.id === 'bigint' ? user.id.toString() : String(user.id);
              userMap.set(userId, user);
            });
            
            // Attach user objects to participants
            return participants.map(participant => {
              const userId = typeof participant.userId === 'bigint' ? participant.userId.toString() : String(participant.userId);
              const user = userMap.get(userId);
              return {
                ...participant,
                user: user
              };
            }).slice(0, limit || participants.length);
          }
        } catch (rawError) {
          console.log(chalk.yellow(`⚠️ GetFullChat failed, falling back to regular getParticipants: ${rawError.message}`));
          // Fallback to regular getParticipants
          const options = limit ? { limit } : {};
          return await this.client.getParticipants(groupEntity, options);
        }
      }
      
      return [];
    } catch (error) {
      if (error.message.includes(CONFIG.ERROR_MESSAGES.ADMIN_REQUIRED) || 
          error.message.includes(CONFIG.ERROR_MESSAGES.CHANNEL_PRIVATE) ||
          error.message.includes(CONFIG.ERROR_MESSAGES.FORBIDDEN)) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Gets the current user's role in a group
   * @param {Object} groupEntity - Telegram group entity
   * @returns {Promise<string>} User role: 'owner', 'admin', or 'member'
   */
  async getUserRole(groupEntity) {
    try {
      const me = await this.client.getMe();
      
      // Check if it's a regular chat or channel
      const isChannel = groupEntity.className === 'Channel';
      
      if (isChannel) {
        // For channels/supergroups, try the direct API method
        try {
          const result = await this.client.invoke(
            new Api.channels.GetParticipant({
              channel: groupEntity,
              participant: me.id
            })
          );
          
          if (result.participant) {
            return RoleManager.getUserRoleFromParticipant(result.participant);
          }
        } catch (directError) {
          // Fallback to getParticipants method
        }
      }

      // For regular chats, use the raw API method
      let participants = [];
      let myParticipant = null;
      
      if (!isChannel) {
        try {
          const chatFull = await this.client.invoke(
            new Api.messages.GetFullChat({
              chatId: groupEntity.id
            })
          );
          
          if (chatFull.fullChat && chatFull.fullChat.participants) {
            // Always use the participants array to get proper role information
            const chatParticipants = chatFull.fullChat.participants.participants || [];
            
            if (chatParticipants.length > 0) {
              const foundParticipant = chatParticipants.find(p => {
                // Handle both BigInt and regular number comparison
                const userId = p.userId;
                const myId = me.id;
                
                // Convert both to strings for reliable comparison
                const userIdStr = typeof userId === 'bigint' ? userId.toString() : String(userId);
                const myIdStr = typeof myId === 'bigint' ? myId.toString() : String(myId);
                
                return userIdStr === myIdStr;
              });
              
              if (foundParticipant) {
                myParticipant = foundParticipant;
              }
            }
            
            // If not found in participants array, check selfParticipant as fallback
            if (!myParticipant && chatFull.fullChat.participants.selfParticipant) {
              myParticipant = chatFull.fullChat.participants.selfParticipant;
            }
          }
        } catch (rawError) {
          // Fallback to getParticipants method
        }
      }
      
      // Fallback to getParticipants for channels or if raw API failed
      if (!myParticipant) {
        participants = await this.client.getParticipants(groupEntity, {});
        
        if (participants.length > 0) {
          myParticipant = participants.find(p => {
            // Handle multiple possible ID fields and BigInt comparison
            const myIdStr = typeof me.id === 'bigint' ? me.id.toString() : String(me.id);
            
            // Check userId field
            if (p.userId) {
              const userIdStr = typeof p.userId === 'bigint' ? p.userId.toString() : String(p.userId);
              if (userIdStr === myIdStr) return true;
            }
            
            // Check id field
            if (p.id) {
              const idStr = typeof p.id === 'bigint' ? p.id.toString() : String(p.id);
              if (idStr === myIdStr) return true;
            }
            
            // Check user.id field
            if (p.user && p.user.id) {
              const userIdStr = typeof p.user.id === 'bigint' ? p.user.id.toString() : String(p.user.id);
              if (userIdStr === myIdStr) return true;
            }
            
            return false;
          });
        }
      }

      if (!myParticipant) {
        return CONFIG.USER_ROLES.MEMBER;
      }
      
      return RoleManager.getUserRoleFromParticipant(myParticipant);
    } catch (error) {
      console.error(chalk.red('❌ Error getting user role:'), error.message);
      return CONFIG.USER_ROLES.MEMBER;
    }
  }

  /**
   * Leaves a group with multiple fallback methods
   * @param {Object} groupEntity - Telegram group entity
   */
  async leaveGroup(groupEntity) {
    // Delete the chat history FIRST while we still have access
    try {
      await this.client.invoke(
        new Api.messages.DeleteHistory({
          peer: groupEntity,
          maxId: 0,
          justClear: false,
          revoke: false
        })
      );
    } catch (historyError) {
      console.warn(chalk.yellow(`⚠️ Could not delete chat history: ${historyError.message}`));
    }

    // Wait for server processing to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    // THEN leave the group
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

  async deleteAllMessages(groupEntity) {
    Logger.action('Deleting all messages...');
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
      await new Promise(resolve => setTimeout(resolve, CONFIG.RATE_LIMIT_DELAY));
    }
    
    if (totalDeleted > 0) {
      Logger.success(`Messages deleted: ${totalDeleted}`);
    } else {
      Logger.warning('No messages to delete');
    }
    
    return totalDeleted;
  }

  async kickAllMembers(groupEntity) {
    Logger.action('Kicking all members...');
    const participants = await this.getParticipants(groupEntity);
    const me = await this.client.getMe();
    const isChannel = groupEntity.className === 'Channel';
    let kickedCount = 0;
    
    for (const participant of participants) {
      if (participant.userId !== me.id) {
        try {
          if (isChannel) {
            // For channels/supergroups
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
          } else {
            // For regular group chats
            await this.client.invoke(
              new Api.messages.DeleteChatUser({
                chatId: groupEntity.id,
                userId: participant.userId
              })
            );
          }
          kickedCount++;
        } catch (kickError) {
          console.warn(chalk.yellow(`⚠️ Could not kick user: ${kickError.message}`));
        }
      }
    }
    
    if (kickedCount > 0) {
      Logger.success(`Members kicked: ${kickedCount}`);
    } else {
      Logger.warning('No members to kick');
    }
    
    return kickedCount;
  }

  async deleteChannelGroup(groupEntity) {
    Logger.action('Deleting the group...');
    
    const isChannel = groupEntity.className === 'Channel';
    
    try {
      if (isChannel) {
        // For channels/supergroups
        await this.client.invoke(
          new Api.channels.DeleteChannel({
            channel: groupEntity
          })
        );
      } else {
        // For regular group chats
        await this.client.invoke(
          new Api.messages.DeleteChat({
            chatId: groupEntity.id
          })
        );
      }
      Logger.success('Group deleted successfully');
      return true;
    } catch (error) {
      Logger.error('Group deletion failed', error);
      return false;
    }
  }

  /**
   * Completely deletes a group (messages, members, group itself)
   * @param {Object} groupEntity - Telegram group entity
   */
  async deleteGroup(groupEntity) {
    try {
      // Step 1: Delete all messages from all users
      await this.deleteAllMessages(groupEntity);
      
      // Step 2: Kick all members except yourself
      await this.kickAllMembers(groupEntity);

      // Step 3: Delete the group
      await this.deleteChannelGroup(groupEntity);

      // Wait for server processing to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Step 4: Delete chat history to ensure it disappears from chat list
      try {
        await this.client.invoke(
          new Api.messages.DeleteHistory({
            peer: groupEntity,
            maxId: 0,
            justClear: false,
            revoke: false
          })
        );
      } catch (historyError) {
        console.warn(chalk.yellow(`⚠️ Could not delete chat history: ${historyError.message}`));
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
    
    Logger.progress('Scanning for groups where you have posted messages...');
    
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
    
    Logger.progress('Scanning for groups where you haven\'t posted messages...');
    
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
      message: chalk.red(`Are you sure you want to delete ALL messages, kick all users, and delete the group "${groupTitle}"?`),
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

  async handleOwnerLeave(group) {
    console.log(chalk.red(`⚠️ You are the owner of "${group.title}"`));
    console.log(chalk.blue('🗑️ Deleting all messages, kicking all users, and deleting group...'));
    await this.groupManager.deleteGroup(group.entity);
    console.log(chalk.green(`✅ Successfully completely deleted "${group.title}"`));
  }

  async handleAdminLeave(group) {
    console.log(chalk.yellow(`⚠️ You are an administrator of "${group.title}"`));
    const stillLeave = await this.uiManager.confirmAdminLeave(group.title);

    if (stillLeave) {
      console.log(chalk.blue('🗑️ Deleting all messages, kicking all users, and deleting group...'));
      await this.groupManager.deleteGroup(group.entity);
      console.log(chalk.green(`✅ Successfully completely deleted "${group.title}"`));
    }
  }

  async handleMemberLeave(group) {
    console.log(chalk.blue('👋 Leaving group...'));
    await this.groupManager.leaveGroup(group.entity);
    console.log(chalk.green(`✅ Left "${group.title}"`));
  }

  async handleLeaveGroup(group) {
    const userRole = await this.groupManager.getUserRole(group.entity);
    
    try {
      if (RoleManager.isOwner(userRole)) {
        await this.handleOwnerLeave(group);
      } else if (RoleManager.isAdmin(userRole)) {
        await this.handleAdminLeave(group);
      } else {
        await this.handleMemberLeave(group);
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

  async displayGroupMembers(groupEntity) {
    try {
      const participants = await this.groupManager.getParticipantsWithRoles(groupEntity, CONFIG.PARTICIPANTS_LIMIT);
      
      if (participants.length === 0) {
        console.log(chalk.yellow('👥 No members found in this group.'));
        return;
      }

      const displayCount = Math.min(participants.length, CONFIG.DISPLAY_MEMBERS_LIMIT);
      const hasMore = participants.length > CONFIG.DISPLAY_MEMBERS_LIMIT;
      
      console.log(chalk.blue(`\n👥 Group members${hasMore ? ` (showing first ${displayCount} of ${participants.length > CONFIG.DISPLAY_MEMBERS_LIMIT ? '15+' : participants.length})` : ` (${participants.length}):`}`));
      
      for (let i = 0; i < displayCount; i++) {
        const participant = participants[i];
        const user = participant.user || participant;
        const role = RoleManager.getUserRoleFromParticipant(participant);
        const displayName = RoleManager.formatUserDisplayName(user, role);
        
        console.log(chalk.gray(`  ${i + 1}. ${displayName}`));
      }
      
      if (hasMore) {
        console.log(chalk.yellow(`  ... and more members`));
      }
    } catch (error) {
      if (error.message.includes(CONFIG.ERROR_MESSAGES.ADMIN_REQUIRED) || 
          error.message.includes(CONFIG.ERROR_MESSAGES.CHANNEL_PRIVATE) ||
          error.message.includes(CONFIG.ERROR_MESSAGES.FORBIDDEN)) {
        console.log(chalk.yellow('👥 Cannot view member list (insufficient permissions)'));
      } else {
        console.log(chalk.red(`❌ Error getting members: ${error.message}`));
      }
    }
  }


  async handleInactiveGroup(group) {
    const userRole = await this.groupManager.getUserRole(group.entity);
    console.log(chalk.blue(`\n📱 Managing inactive group: ${group.title} (${group.type}) ${chalk.cyan(`[${userRole.toUpperCase()}]`)}`));
    
    // Show group members
    await this.displayGroupMembers(group.entity);
    
    const leaveGroup = await this.uiManager.askLeaveGroup(group.title);

    if (leaveGroup) {
      await this.handleLeaveGroup(group);
    }
    
    this.groupDataManager.markGroupAsProcessed(group.id);
  }

  async deleteUserMessages(group, messages) {
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

  async handleMessageDeletion(group, messages) {
    const confirm = await this.uiManager.confirmDeletion(messages.length, group.title);

    if (confirm) {
      await this.deleteUserMessages(group, messages);
    }
  }

  async handleFullMessageDisplay(group, messages) {
    this.uiManager.displayFullMessages(messages);

    const deleteAfterShow = await this.uiManager.confirmDeletion(messages.length, group.title);

    if (deleteAfterShow) {
      await this.deleteUserMessages(group, messages);
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

    console.log(chalk.green(`📋 Found ${messages.length} of your messages in this group.`));

    // Show group members
    await this.displayGroupMembers(group.entity);

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