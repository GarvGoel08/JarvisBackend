// WebAgent.js

const { chromium } = require('playwright');
const axios = require('axios');
const cheerio = require('cheerio');
const { callLangChain } = require('../services/langchain');

/**
 * A singular, general-purpose web agent that intelligently handles tasks
 * through an iterative loop with full AI control.
 *
 * @param {Object} params - The parameters for the web operation.
 * @param {string} params.url - The target URL.
 * @param {string} params.task - The user's task description.
 * @param {number} [params.maxIterations=5] - The maximum number of loop iterations.
 * @returns {Promise<Object>} - The final result of the task.
 */
async function WebAgent(params) {
  const { url, task } = params;
  const maxIterations = 8;
  if (!url || !task) {
    throw new Error("Both 'url' and 'task' are required.");
  }

  console.log(`[WebAgent] Starting task: "${task}" on ${url}`);

  let browser, page;
  let currentUrl = url;
  let currentIteration = 0;
  let taskCompleted = false;
  let finalResult = null;
  const allSteps = [];

  try {
    browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
    page = await context.newPage();

    await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000); // Initial wait for page to settle

    // --- Main Iteration Loop ---
    while (!taskCompleted && currentIteration < maxIterations) {
      currentIteration++;
      console.log(`[WebAgent] Starting iteration ${currentIteration}/${maxIterations}`);

      const pageState = await getComprehensiveDOM(page);

      // AI decides the next action based on a complete view of the page
      const { action, finalAnswer, isCompleted, confidence } = await getNextAction(pageState, task, allSteps);

      // Check if the AI has a definitive answer
      if (isCompleted && confidence > 0.8) {
        taskCompleted = true;
        finalResult = finalAnswer;
        console.log(`[WebAgent] AI confirms task is complete with confidence ${confidence}`);
        break; // Exit the loop
      }

      // Execute the planned action
      const actionResult = await executeAction(page, action);
      
      // Store the result of the action in the history
      allSteps.push({
        iteration: currentIteration,
        action,
        result: actionResult,
        pageUrl: page.url()
      });

      // If action failed, log and break
      if (!actionResult.success) {
        console.error(`[WebAgent] Action failed: ${actionResult.error}. Aborting loop.`);
        break;
      }
    }

    // Prepare final result if loop exited without completion
    if (!taskCompleted) {
      console.log('[WebAgent] Max iterations reached or loop aborted. Generating partial summary.');
      finalResult = await generatePartialResult(task, allSteps);
      taskCompleted = false;
    }

    return {
      isCompleted: taskCompleted,
      result: finalResult,
      totalIterations: currentIteration,
      url: page.url(),
      task,
    };

  } catch (error) {
    console.error(`[WebAgent] Fatal error: ${error.message}`);
    return {
      isCompleted: false,
      error: true,
      message: `WebAgent failed: ${error.message}`,
      url,
      task,
    };
  } finally {
    if (browser) {
      await browser.close();
      console.log('[WebAgent] Browser closed.');
    }
  }
}

/**
 * Extracts a comprehensive, structured DOM representation for the LLM.
 * This is the "BeautifulSoup-like" equivalent for JavaScript.
 */
async function getComprehensiveDOM(page) {
  try {
    const domData = await page.evaluate(() => {
      const getSelector = (el) => {
        if (el.id) return `#${el.id}`;
        if (el.name) return `[name="${el.name}"]`;
        if (el.className) return `.${el.className.split(' ')[0]}`;
        return el.tagName.toLowerCase();
      };
      
      const elements = Array.from(document.querySelectorAll('a, button, input, textarea, select, h1, h2, h3, p, [role="button"]'));
      const relevantElements = elements.map((el, index) => {
        const rect = el.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).visibility !== 'hidden';
        
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.value || el.placeholder || '').trim().slice(0, 100),
          selector: getSelector(el),
          id: el.id,
          name: el.name,
          class: el.className,
          href: el.href || '',
          type: el.type,
          role: el.getAttribute('role'),
          isVisible,
          index, // For fallback selectors if needed
        };
      });

      return {
        url: window.location.href,
        title: document.title,
        text: document.body.innerText.slice(0, 5000),
        elements: relevantElements.filter(el => el.isVisible),
      };
    });
    return domData;
  } catch (e) {
    console.error(`Error extracting DOM: ${e.message}`);
    return { url: page.url(), title: 'Error', text: '', elements: [] };
  }
}
/**
 * Asks the LLM for the single next best action to take.
 */
async function getNextAction(pageState, task, allSteps) {
  const systemPrompt = `You are a web automation expert. Your goal is to navigate and interact with a website to complete a specific task.
  You have access to a live snapshot of the page's DOM and a history of all previous actions.
  
  Instructions:
  1. Analyze the 'Task', 'Page State', and 'Action History'.
  2. Determine the single best action to take next to make progress.
  3. If the task is completed, set "isCompleted" to true and provide the "finalAnswer".
  4. If you are stuck or need to load more content, use a "scroll" action.
  5. Your response MUST be a single JSON object.

  Current Task: "${task}"

  Page State (DOM):
  ${JSON.stringify(pageState, null, 2)}

  Action History (last 2 steps):
  ${JSON.stringify(allSteps.slice(-2), null, 2)}
  
  Respond with JSON:
  {
    "action": {
      "type": "click|fill|navigate|scroll|wait",
      "target": "CSS_SELECTOR",
      "value": "Optional value for fill/navigate/wait",
      "reasoning": "Why this action was chosen."
    },
    "isCompleted": true|false,
    "confidence": 0-1,
    "finalAnswer": "Summary of the final result if completed, or an empty string."
  }
  
  Example Actions:
  - Fill a search box: { "type": "fill", "target": "input[name='q']", "value": "best phone", "reasoning": "Identified the search input by its name attribute." }
  - Click a button: { "type": "click", "target": "button.search-button", "reasoning": "Found the search button with a specific class." }
  - Scroll down: { "type": "scroll", "target": "body", "value": "500", "reasoning": "Scrolling to load more dynamic content on the page." }
  `;

  try {
    const response = await callLangChain(systemPrompt, 'What is the next action?');
    const cleanedResponse = response.replace(/```json|```/g, '').trim();
    return JSON.parse(cleanedResponse);
  } catch (error) {
    console.warn(`[WebAgent] Failed to get next action from LLM. Assuming a fallback scroll.`);
    return {
      action: {
        type: 'scroll',
        target: 'body',
        reasoning: 'Fallback action due to LLM failure.'
      },
      isCompleted: false,
      confidence: 0,
      finalAnswer: '',
    };
  }
}

/**
 * Executes a single action on the page.
 */
async function executeAction(page, action) {
  try {
    const { type, target, value } = action;
    await page.waitForTimeout(500); // Small delay for stability

    switch (type) {
      case 'click':
        await page.click(target, { timeout: 10000 });
        break;
      case 'fill':
        await page.fill(target, value, { timeout: 10000 });
        break;
      case 'navigate':
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
        break;
      case 'scroll':
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        break;
      case 'wait':
        await page.waitForTimeout(parseInt(value) || 2000);
        break;
      default:
        throw new Error(`Unsupported action type: ${type}`);
    }
    return { success: true, message: 'Action executed successfully.' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Generates a partial summary if the task is not completed.
 */
async function generatePartialResult(task, allSteps) {
  const summaryPrompt = `Based on the following actions, summarize what was achieved and why the task was not fully completed.
  Task: "${task}"
  Actions Performed: ${JSON.stringify(allSteps, null, 2)}
  `;

  try {
    const summary = await callLangChain('You are a task summarizer. Provide a concise summary of the task\'s status.', summaryPrompt);
    return {
      status: 'Incomplete',
      summary,
      steps: allSteps.length,
    };
  } catch (e) {
    return {
      status: 'Incomplete',
      summary: 'Failed to generate a summary. The task could not be completed.',
      steps: allSteps.length,
    };
  }
}

module.exports = { WebAgent };