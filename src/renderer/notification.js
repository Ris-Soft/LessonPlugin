// notification.js
document.addEventListener('DOMContentLoaded', () => {
  const titleEl = document.getElementById('title-text');
  const contentEl = document.getElementById('content-text');
  const closeBtn = document.getElementById('close-btn');
  const detailBtn = document.getElementById('detail-btn');
  const actionsContainer = document.getElementById('actions-container');

  // Close button
  closeBtn.addEventListener('click', () => {
    window.notificationAPI?.close();
  });

  // Detail button
  detailBtn.addEventListener('click', () => {
    window.notificationAPI?.action('details');
  });

  // Listen for content updates
  window.notificationAPI?.onUpdate((data) => {
    if (data.title) titleEl.textContent = data.title;
    if (data.content) {
      // Allow basic HTML for lists etc.
      contentEl.innerHTML = data.content;
    }
    
    // Toggle actions
    if (data.hasDetails) {
      actionsContainer.style.display = 'flex';
    } else {
      actionsContainer.style.display = 'none';
    }
  });
});
