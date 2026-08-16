<?php
/**
 * Plugin Name: KVL Chatbot
 * Plugin URI: https://superai.kvlbusinesssolutions.com
 * Description: Adds your KVL AI chat widget to every page of this site. No code editing required — paste your Installation ID from the KVL dashboard (Dashboard &rarr; Overview) and save.
 * Version: 1.0.0
 * Requires at least: 5.0
 * Requires PHP: 7.2
 * Author: KVL Business Solutions
 * Author URI: https://kvlbusinesssolutions.com
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: kvl-chatbot
 */

// No direct access — this file only does anything when WordPress loads it.
if (!defined('ABSPATH')) {
    exit;
}

define('KVL_CHATBOT_OPTION', 'kvl_chatbot_installation_id');
define('KVL_CHATBOT_ORIGIN', 'https://superai.kvlbusinesssolutions.com');
define('KVL_CHATBOT_VERSION', '1.0.0');

/**
 * Settings page — the whole plugin's UI is one field. Installing this
 * plugin is itself the "grant access" step (the same trust boundary as
 * installing any WordPress plugin); once the Installation ID is saved,
 * the widget goes live with no further action.
 */
add_action('admin_menu', function () {
    add_options_page(
        __('KVL Chatbot', 'kvl-chatbot'),
        __('KVL Chatbot', 'kvl-chatbot'),
        'manage_options',
        'kvl-chatbot',
        'kvl_chatbot_render_settings_page'
    );
});

add_action('admin_init', function () {
    register_setting('kvl_chatbot_settings_group', KVL_CHATBOT_OPTION, [
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => '',
    ]);
});

/** Adds a "Settings" link next to Activate/Deactivate on the Plugins list page. */
add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
    $settings_link = '<a href="' . esc_url(admin_url('options-general.php?page=kvl-chatbot')) . '">' . esc_html__('Settings', 'kvl-chatbot') . '</a>';
    array_unshift($links, $settings_link);
    return $links;
});

function kvl_chatbot_render_settings_page() {
    if (!current_user_can('manage_options')) {
        return;
    }
    $installation_id = get_option(KVL_CHATBOT_OPTION, '');
    ?>
    <div class="wrap">
        <h1><?php esc_html_e('KVL Chatbot', 'kvl-chatbot'); ?></h1>
        <p>
            <?php esc_html_e('Paste the Installation ID from your KVL dashboard (Dashboard -> Overview) below to activate the chat widget on this site.', 'kvl-chatbot'); ?>
        </p>
        <form method="post" action="options.php">
            <?php settings_fields('kvl_chatbot_settings_group'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row">
                        <label for="kvl_chatbot_installation_id"><?php esc_html_e('Installation ID', 'kvl-chatbot'); ?></label>
                    </th>
                    <td>
                        <input
                            type="text"
                            id="kvl_chatbot_installation_id"
                            name="<?php echo esc_attr(KVL_CHATBOT_OPTION); ?>"
                            value="<?php echo esc_attr($installation_id); ?>"
                            class="regular-text"
                            placeholder="inst_xxxxxxxxxxxxxxxx"
                            autocomplete="off"
                        />
                    </td>
                </tr>
            </table>
            <?php submit_button(__('Save &amp; Activate', 'kvl-chatbot')); ?>
        </form>

        <?php if (!empty($installation_id)) : ?>
            <p style="color:#1a7f37;font-weight:600;">
                &#10003; <?php esc_html_e('Chat widget is active on this site.', 'kvl-chatbot'); ?>
            </p>
        <?php else : ?>
            <p style="color:#996800;">
                <?php esc_html_e('Chat widget is not active yet - paste your Installation ID above and save.', 'kvl-chatbot'); ?>
            </p>
        <?php endif; ?>
    </div>
    <?php
}

/** A visible reminder in wp-admin until the plugin is actually configured — nothing installs silently or half-works without the site owner noticing. */
add_action('admin_notices', function () {
    if (!current_user_can('manage_options')) {
        return;
    }
    if (get_option(KVL_CHATBOT_OPTION, '')) {
        return;
    }
    $screen = function_exists('get_current_screen') ? get_current_screen() : null;
    if ($screen && $screen->id === 'settings_page_kvl-chatbot') {
        return; // already on the settings page, no need to also nag there
    }
    $settings_url = esc_url(admin_url('options-general.php?page=kvl-chatbot'));
    echo '<div class="notice notice-warning is-dismissible"><p>'
        . esc_html__('KVL Chatbot is installed but not configured yet.', 'kvl-chatbot')
        . ' <a href="' . $settings_url . '">' . esc_html__('Add your Installation ID', 'kvl-chatbot') . '</a>'
        . '</p></div>';
});

/**
 * The actual integration — one line in the footer of every page, exactly
 * matching the manual copy-paste method (Method A in the platform's own
 * install guide), just placed automatically by WordPress's own hook
 * system instead of hand-editing theme files.
 */
add_action('wp_footer', function () {
    $installation_id = get_option(KVL_CHATBOT_OPTION, '');
    if (empty($installation_id)) {
        return;
    }
    printf(
        '<script src="%s" data-installation-id="%s"></script>' . "\n",
        esc_url(KVL_CHATBOT_ORIGIN . '/widget.js'),
        esc_attr($installation_id)
    );
});

/** Leaves nothing behind when the site owner removes the plugin. */
register_uninstall_hook(__FILE__, 'kvl_chatbot_uninstall');
function kvl_chatbot_uninstall() {
    delete_option(KVL_CHATBOT_OPTION);
}
