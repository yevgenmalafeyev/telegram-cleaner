# Telegram Message Cleaner

**Author:** Yevgen Malafeyev  
**Contact:** yevgen.malafeyev@gmail.com  
**Version:** 2.0.0 (Last updated: July 14, 2025)

## Overview

Telegram Message Cleaner is a simple command-line tool that helps you manage your Telegram presence by cleaning up your message history and leaving inactive groups.

## Installation

### Prerequisites

#### For Mac:

1. **Install Node.js:**
   ```bash
   # Using Homebrew (recommended)
   brew install node
   
   # Or download from https://nodejs.org/
   ```

2. **Verify installation:**
   ```bash
   node --version
   npm --version
   ```

#### For Windows:

1. **Install Node.js:**
   - Download the Windows installer from [nodejs.org](https://nodejs.org/)
   - Run the installer and follow the setup wizard
   - Choose "Add to PATH" during installation

2. **Verify installation:**
   ```cmd
   node --version
   npm --version
   ```

### Script Installation

1. **Download the project:**
   ```bash
   git clone <repository-url>
   cd telegram-cleaner
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Get Telegram API credentials:**
   - Go to [https://my.telegram.org/auth](https://my.telegram.org/auth)
   - Log in with your phone number
   - Navigate to "API development tools"
   - Create a new application:
     - App title: Any name (e.g., "Telegram Cleaner")
     - Short name: Any short name
     - Platform: Desktop
     - Description: Optional
   - Save your `api_id` and `api_hash`

## Usage

Run the script:
```bash
npm start
```

On first run, you'll be prompted to enter:
- Your Telegram API ID
- Your Telegram API Hash  
- Your phone number (with country code)
- Verification code sent to your Telegram app
- 2FA password (if enabled)

The script will ask if you want to save these credentials for future use.

## Detailed Functionality

### Feature 1: Manage Groups Where You Have Posted Messages

This feature helps you clean up your message history across Telegram groups and channels.

**How it works:**
1. **Scanning**: The script scans your 200 most recent dialogs (groups and channels)
2. **Message Detection**: For each group, it checks if you have posted any messages
3. **Sorting**: Groups are sorted by message count (least to most messages)
4. **Selection**: You can select any group to manage your messages
5. **Preview**: Shows a preview of your messages with timestamps
6. **Actions Available:**
   - **Delete all messages**: Bulk delete all your messages from the selected group
   - **Show full message list**: Display complete message content before deletion
   - **Go back**: Return to group selection

**Post-Deletion Options:**
- **Leave Group**: After deleting messages, you can choose to leave the group
- **Owner Controls**: If you're the group owner, you can:
  - Kick all members and delete the entire group
  - Or simply leave the group
- **Admin Warning**: If you're an admin, you'll be warned about losing privileges

### Feature 2: Manage Groups Where You Haven't Posted Messages

This feature helps you clean up your group memberships by leaving inactive groups.

**How it works:**
1. **Scanning**: Scans your dialogs for groups where you have 0 messages
2. **Categorization**: Groups are separated into two categories:
   - **Groups**: Regular group chats
   - **Channels**: Telegram channels
3. **Activity Sorting**: Within each category, groups are sorted by last activity (least active first)
4. **Display Format**: Shows group name and last activity date
5. **Selection**: Choose any group to manage your membership

**Actions Available:**
- **Leave Group**: Confirms and leaves the selected group
- **Owner Controls**: Same as Feature 1 - option to delete entire group if you're the owner
- **Admin Handling**: Warns about losing admin privileges before leaving

### Technical Details

- **Language**: JavaScript (Node.js)
- **Telegram API**: Uses the official Telegram Client API
- **Dependencies**: 
  - `telegram`: Telegram API client
  - `inquirer`: Interactive command-line prompts
  - `chalk`: Terminal styling
- **Storage**: 
  - `telegram-config.json`: User credentials
  - `telegram-session.json`: Login session data
- **Limits**: 
  - Scans up to 200 most recent dialogs
  - Processes up to 100 messages per group for counting
  - No limit on message deletion

**Support:**
For issues or questions, contact: yevgen.malafeyev@gmail.com