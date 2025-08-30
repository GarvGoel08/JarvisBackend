// WebAgent.js

const { chromium } = require('playwright');
const axios = require('axios');
const cheerio = require('cheerio');
const { callLangChain } = require('../services/langchain');
const contentManager = require('../utils/contentManager');

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
    // Enhanced browser configuration for better compatibility
    browser = await chromium.launch({ 
      headless: false, 
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizDisplayCompositor',
        '--disable-web-security',
        '--no-first-run',
        '--disable-extensions'
      ]
    });
    
    const context = await browser.newContext({ 
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      timezoneId: 'America/New_York'
    });
    
    page = await context.newPage();
    
    // Set additional headers to appear more like a real browser
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });

    console.log(`[WebAgent] Navigating to: ${currentUrl}`);
    await page.goto(currentUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 
    });
    
    // Wait for initial page load and any dynamic content
    await page.waitForTimeout(3000);
    
    // Check for and handle common anti-bot measures
    const hasRobotCheck = await page.evaluate(() => {
      return document.body.innerHTML.toLowerCase().includes('robot') || 
             document.title.toLowerCase().includes('robot') ||
             document.querySelector('iframe[src*="captcha"]') !== null;
    });
    
    if (hasRobotCheck) {
      console.warn('[WebAgent] Robot detection page encountered, waiting longer...');
      await page.waitForTimeout(5000);
    }

    // --- Main Iteration Loop ---
    while (!taskCompleted && currentIteration < maxIterations) {
      currentIteration++;
      console.log(`[WebAgent] Starting iteration ${currentIteration}/${maxIterations}`);

      const pageState = await getComprehensiveDOM(page);

      // AI decides the next action based on a complete view of the page
      const { action, finalAnswer, isCompleted, confidence } = await getNextAction(pageState, task, allSteps);

      // Check if the AI has a definitive answer or extracted data
      if (isCompleted && confidence > 0.7) {
        taskCompleted = true;
        finalResult = finalAnswer;
        console.log(`[WebAgent] AI confirms task is complete with confidence ${confidence}`);
        break; // Exit the loop
      }

      // Special handling for extract actions
      if (action && action.type === 'extract') {
        const actionResult = await executeAction(page, action);
        
        if (actionResult.success && actionResult.data) {
          // Check if extraction returned meaningful data
          const hasItems = (actionResult.data.items && actionResult.data.items.length > 0) ||
                          (actionResult.data.products && actionResult.data.products.length > 0);
          
          if (hasItems) {
            taskCompleted = true;
            const itemCount = actionResult.data.items?.length || actionResult.data.products?.length || 0;
            finalResult = {
              status: 'Completed',
              extractedData: actionResult.data,
              summary: `Successfully extracted ${itemCount} items from ${actionResult.data.pageUrl}`
            };
            console.log(`[WebAgent] Data extraction completed with ${itemCount} items`);
            break;
          } else {
            // Extraction returned no data, continue with more actions
            allSteps.push({
              iteration: currentIteration,
              action,
              result: actionResult,
              pageUrl: page.url()
            });
            console.log(`[WebAgent] Extraction returned no data, continuing search...`);
            continue;
          }
        }
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

      // Enhanced error handling
      if (!actionResult.success) {
        console.error(`[WebAgent] Action failed: ${actionResult.error}.`);
        
        // Don't immediately abort - try a recovery action
        if (currentIteration < maxIterations - 1) {
          console.log(`[WebAgent] Attempting recovery in next iteration...`);
          continue;
        } else {
          console.log(`[WebAgent] Max iterations reached, generating summary with partial data...`);
          break;
        }
      }
      
      // URL change detection
      const newUrl = page.url();
      if (newUrl !== currentUrl) {
        console.log(`[WebAgent] Page navigation detected: ${currentUrl} -> ${newUrl}`);
        currentUrl = newUrl;
        await page.waitForTimeout(2000); // Extra wait after navigation
      }
    }

    // Prepare final result if loop exited without completion
    if (!taskCompleted) {
      console.log('[WebAgent] Task not completed within iterations. Attempting final extraction...');
      
      // Try one final extraction attempt before giving up
      try {
        const finalExtractionResult = await performIntelligentExtraction(page, 'body', task);
        
        if (finalExtractionResult.items && finalExtractionResult.items.length > 0) {
          taskCompleted = true;
          finalResult = {
            status: 'Completed via final extraction',
            extractedData: finalExtractionResult,
            summary: `Extracted ${finalExtractionResult.items.length} items in final attempt`
          };
          console.log(`[WebAgent] Final extraction successful: ${finalExtractionResult.items.length} items found`);
        } else {
          finalResult = await generatePartialResult(task, allSteps);
          taskCompleted = false;
        }
      } catch (e) {
        console.error(`[WebAgent] Final extraction failed: ${e.message}`);
        finalResult = await generatePartialResult(task, allSteps);
        taskCompleted = false;
      }
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
      // Enhanced selector generation with proper CSS escaping
      const getSelector = (el, index) => {
        // Helper function to escape CSS selectors
        const escapeSelector = (str) => {
          if (!str) return '';
          // Escape special characters for CSS selectors
          return str.replace(/[\!"#$%&'()*+,.\/:;<=>?@\[\\\]^`{|}~]/g, '\\$&');
        };
        
        // Helper function to validate selector
        const isValidSelector = (selector) => {
          try {
            document.querySelector(selector);
            return true;
          } catch (e) {
            return false;
          }
        };
        
        // Priority 1: Unique ID (with proper escaping)
        if (el.id) {
          const escapedId = escapeSelector(el.id);
          const selector = `#${escapedId}`;
          if (isValidSelector(selector) && document.querySelectorAll(selector).length === 1) {
            return selector;
          }
        }
        
        // Priority 2: Data attributes (common in e-commerce)
        const dataAttrs = ['data-testid', 'data-cy', 'data-automation-id', 'data-component-type'];
        for (const attr of dataAttrs) {
          if (el.hasAttribute(attr)) {
            const value = el.getAttribute(attr);
            const selector = `[${attr}="${escapeSelector(value)}"]`;
            if (isValidSelector(selector) && document.querySelectorAll(selector).length <= 3) {
              return selector;
            }
          }
        }
        
        // Priority 3: Name attribute for inputs
        if (el.name && el.tagName.toLowerCase() === 'input') {
          const selector = `input[name="${escapeSelector(el.name)}"]`;
          if (isValidSelector(selector)) {
            return selector;
          }
        }
        
        // Priority 4: Class-based with validation
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.trim().split(/\s+/).filter(cls => cls.length > 0);
          // Try most specific class combinations first
          for (let i = Math.min(2, classes.length); i > 0; i--) {
            const classSelector = `.${classes.slice(0, i).map(escapeSelector).join('.')}`;
            if (isValidSelector(classSelector) && document.querySelectorAll(classSelector).length <= 5) {
              return classSelector;
            }
          }
          
          // Try single class if multi-class failed
          if (classes.length > 0) {
            const singleClassSelector = `.${escapeSelector(classes[0])}`;
            if (isValidSelector(singleClassSelector) && document.querySelectorAll(singleClassSelector).length <= 10) {
              return singleClassSelector;
            }
          }
        }
        
        // Priority 5: Tag with nth-child (most reliable fallback)
        const parent = el.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(child => 
            child.tagName === el.tagName
          );
          const position = siblings.indexOf(el) + 1;
          if (position > 0) {
            return `${el.tagName.toLowerCase()}:nth-of-type(${position})`;
          }
        }
        
        // Final fallback - just tag name with index
        return `${el.tagName.toLowerCase()}`;
      };
      
      // Smarter element selection based on task context
      const taskRelevantSelectors = [
        // E-commerce specific
        '[data-component-type*="product"]',
        '[data-component-type*="item"]',
        '.s-result-item',
        '.product-item',
        '.product-card',
        '[data-testid*="product"]',
        
        // General interactive elements
        'a[href*="product"]',
        'a[href*="item"]',
        'button',
        'input',
        'textarea',
        'select',
        '[role="button"]',
        '[role="link"]',
        
        // Content structure
        'h1, h2, h3, h4',
        '.price',
        '.rating',
        '.review',
        '[class*="price"]',
        '[class*="rating"]',
        '[class*="review"]',
        
        // Navigation
        'form',
        '.pagination',
        '.next',
        '.load-more'
      ];
      
      const allElements = new Set();
      
      // Collect elements using task-relevant selectors
      taskRelevantSelectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => allElements.add(el));
        } catch (e) {
          // Skip invalid selectors
        }
      });
      
      // Convert to array and process with error handling
      const elementsArray = Array.from(allElements);
      const relevantElements = [];
      
      elementsArray.forEach((el, index) => {
        try {
          const rect = el.getBoundingClientRect();
          const computedStyle = window.getComputedStyle(el);
          const isVisible = rect.width > 0 && rect.height > 0 && 
                           computedStyle.display !== 'none' && 
                           computedStyle.visibility !== 'hidden' &&
                           computedStyle.opacity !== '0';
          
          // Enhanced text extraction
          let elementText = '';
          if (el.value) elementText = el.value;
          else if (el.placeholder) elementText = el.placeholder;
          else if (el.alt) elementText = el.alt;
          else if (el.title) elementText = el.title;
          else elementText = el.textContent || '';
          
          elementText = elementText.trim().slice(0, 200);
          
          // Generate selector safely
          let selector;
          try {
            selector = getSelector(el, index);
          } catch (selectorError) {
            selector = `${el.tagName.toLowerCase()}:nth-child(${index + 1})`;
          }
          
          relevantElements.push({
            tag: el.tagName.toLowerCase(),
            text: elementText,
            selector: selector,
            id: el.id || '',
            name: el.name || '',
            class: el.className || '',
            href: el.href || '',
            type: el.type || '',
            role: el.getAttribute('role') || '',
            isVisible,
            // Additional useful attributes
            dataTestId: el.getAttribute('data-testid') || '',
            dataComponentType: el.getAttribute('data-component-type') || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            // Position info for better targeting
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            }
          });
        } catch (elementError) {
          // Skip problematic elements instead of crashing
          console.warn('Skipping element due to error:', elementError.message);
        }
      });

      // Filter and prioritize visible, interactive elements
      const visibleElements = relevantElements.filter(el => 
        el.isVisible && (
          el.text.length > 0 || 
          ['input', 'button', 'select', 'textarea'].includes(el.tag) ||
          el.href ||
          el.role === 'button' ||
          el.role === 'link'
        )
      );

      // Sort by relevance (interactive elements first, then by text length)
      visibleElements.sort((a, b) => {
        const aInteractive = ['a', 'button', 'input', 'select', 'textarea'].includes(a.tag) || a.role === 'button';
        const bInteractive = ['a', 'button', 'input', 'select', 'textarea'].includes(b.tag) || b.role === 'button';
        
        if (aInteractive && !bInteractive) return -1;
        if (!aInteractive && bInteractive) return 1;
        
        return b.text.length - a.text.length;
      });

      // Extract structured page content
      const pageContent = {
        url: window.location.href,
        title: document.title,
        readyState: document.readyState,
        
        // Core elements (limited for token efficiency)
        elements: visibleElements.slice(0, 50), // Top 50 most relevant
        
        // Page structure
        headings: Array.from(document.querySelectorAll('h1, h2, h3, h4')).map((h, i) => ({
          text: h.textContent.trim().slice(0, 150),
          level: parseInt(h.tagName.charAt(1)),
          selector: getSelector(h, i)
        })).slice(0, 15),
        
        // Forms for interaction
        forms: Array.from(document.querySelectorAll('form')).map((form, i) => ({
          action: form.action || '',
          method: form.method || 'get',
          selector: getSelector(form, i),
          inputCount: form.querySelectorAll('input, textarea, select').length,
          hasSearchInput: form.querySelector('input[type="search"], input[name*="search"], input[placeholder*="search"]') !== null
        })).slice(0, 5),
        
        // Page metrics
        metrics: {
          totalElements: elementsArray.length,
          visibleElements: visibleElements.length,
          interactiveElements: visibleElements.filter(el => 
            ['a', 'button', 'input', 'select', 'textarea'].includes(el.tag) || el.role === 'button'
          ).length,
          hasLoadingIndicators: document.querySelector('[class*="loading"], [class*="spinner"], [data-testid*="loading"]') !== null
        }
      };

      return pageContent;
    });
    
    console.log(`[WebAgent] Extracted DOM: ${domData.elements?.length || 0} elements, ${domData.metrics?.interactiveElements || 0} interactive`);
    
    return domData;
    
  } catch (e) {
    console.error(`[WebAgent] Error extracting DOM: ${e.message}`);
    return { 
      url: await page.url(), 
      title: 'Error', 
      elements: [], 
      error: e.message,
      metrics: { totalElements: 0, visibleElements: 0, interactiveElements: 0 }
    };
  }
}
/**
 * Asks the LLM for the single next best action to take.
 */
async function getNextAction(pageState, task, allSteps) {
  try {
    // Intelligent content optimization based on task and page state
    let optimizedPageState = pageState;
    
    // If content is too large, use smart filtering instead of truncation
    if (JSON.stringify(pageState).length > 15000) {
      optimizedPageState = {
        url: pageState.url,
        title: pageState.title,
        readyState: pageState.readyState,
        
        // Prioritize elements based on task keywords
        elements: filterElementsByRelevance(pageState.elements || [], task).slice(0, 30),
        headings: pageState.headings?.slice(0, 10) || [],
        forms: pageState.forms || [],
        metrics: pageState.metrics || {}
      };
    }
    
    // Enhanced system prompt with better instructions
    const systemPrompt = `You are an expert web automation agent. Analyze the current page state and determine the best next action to complete the given task.

IMPORTANT GUIDELINES:
1. For data extraction tasks, look for patterns in element classes, data attributes, or text content
2. When you can see the required data on the page, use "extract" action type to collect it
3. Only scroll if you need to see more content or load more items
4. If the page shows loading indicators, wait for them to disappear
5. Focus on interactive elements that directly help accomplish the task
6. For e-commerce sites, look for product containers, price elements, rating elements

RESPONSE FORMAT (valid JSON only):
{
  "action": {
    "type": "click|fill|navigate|scroll|wait|extract",
    "target": "CSS_SELECTOR_OR_EXTRACT_PATTERN",
    "value": "value for fill/navigate/wait actions, or extraction query for extract",
    "reasoning": "Clear explanation of why this action was chosen"
  },
  "isCompleted": true|false,
  "confidence": 0.0-1.0,
  "finalAnswer": "Final result if task is complete, empty string otherwise"
}`;
    
    // More focused user prompt
    const taskKeywords = extractTaskKeywords(task);
    const relevantElements = optimizedPageState.elements?.filter(el => 
      isElementRelevantToTask(el, taskKeywords)
    ) || [];
    
    const userPrompt = `TASK: ${task}

CURRENT PAGE:
- URL: ${optimizedPageState.url}
- Title: ${optimizedPageState.title}
- Status: ${optimizedPageState.readyState || 'unknown'}
- Total Elements: ${optimizedPageState.elements?.length || 0}
- Interactive Elements: ${optimizedPageState.metrics?.interactiveElements || 0}

KEY ELEMENTS FOUND:
${JSON.stringify(relevantElements.slice(0, 20), null, 2)}

PAGE STRUCTURE:
${JSON.stringify({
  headings: optimizedPageState.headings?.slice(0, 5),
  forms: optimizedPageState.forms,
  hasLoadingIndicators: optimizedPageState.metrics?.hasLoadingIndicators
}, null, 2)}

PREVIOUS ACTIONS: ${allSteps.length > 0 ? JSON.stringify(allSteps.slice(-2), null, 2) : 'None'}

Determine the next action. If you can extract the required data from the visible elements, use the "extract" action type.`;

    const response = await callLangChain(systemPrompt, userPrompt, { 
      maxTokens: 1000,
      temperature: 0.1 // Lower temperature for more consistent responses
    });
    console.log('[WebAgent] LLM Response:', response);
    // Better JSON parsing with multiple strategies
    const parsedResponse = parseAIResponse(response);
    
    // Validate the response structure
    if (!parsedResponse.action || !parsedResponse.action.type) {
      throw new Error('Invalid response structure from LLM');
    }
    
    console.log(`[WebAgent] LLM suggested action: ${parsedResponse.action.type} - ${parsedResponse.action.reasoning}`);
    
    return parsedResponse;
    
  } catch (error) {
    console.warn(`[WebAgent] LLM failed (${error.message}), using intelligent fallback`);
    
    // Intelligent fallback based on page state and task
    return generateIntelligentFallback(pageState, task, allSteps);
  }
}

/**
 * Extract keywords from task for element filtering
 */
function extractTaskKeywords(task) {
  const keywords = task.toLowerCase().match(/\b\w{3,}\b/g) || [];
  return [...new Set(keywords)]; // Remove duplicates
}

/**
 * Check if element is relevant to the task
 */
function isElementRelevantToTask(element, keywords) {
  const elementText = (element.text || '').toLowerCase();
  const elementClass = (element.class || '').toLowerCase();
  const elementId = (element.id || '').toLowerCase();
  
  return keywords.some(keyword => 
    elementText.includes(keyword) || 
    elementClass.includes(keyword) || 
    elementId.includes(keyword)
  );
}

/**
 * Filter elements by relevance to task
 */
function filterElementsByRelevance(elements, task) {
  const keywords = extractTaskKeywords(task);
  
  return elements
    .map(el => ({
      ...el,
      relevanceScore: calculateRelevanceScore(el, keywords)
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .filter(el => el.relevanceScore > 0);
}

/**
 * Calculate relevance score for an element
 */
function calculateRelevanceScore(element, keywords) {
  let score = 0;
  const text = (element.text || '').toLowerCase();
  const className = (element.class || '').toLowerCase();
  const id = (element.id || '').toLowerCase();
  
  // Base scores for element types
  if (['a', 'button'].includes(element.tag)) score += 2;
  if (element.href) score += 1;
  if (['input', 'select', 'textarea'].includes(element.tag)) score += 1;
  
  // Keyword matching
  keywords.forEach(keyword => {
    if (text.includes(keyword)) score += 3;
    if (className.includes(keyword)) score += 2;
    if (id.includes(keyword)) score += 2;
  });
  
  // E-commerce specific scoring
  if (text.match(/\$|₹|price|rating|review|buy|add to cart/i)) score += 2;
  if (className.match(/product|item|card|price|rating/i)) score += 2;
  
  return score;
}

/**
 * Parse AI response with multiple fallback strategies
 */
function parseAIResponse(response) {
  // Clean the response
  let cleanedResponse = response
    .replace(/```json|```/g, '')
    .replace(/^[^{]*({.*})[^}]*$/s, '$1')
    .trim();
  
  // Try direct JSON parsing
  try {
    return JSON.parse(cleanedResponse);
  } catch (e) {
    console.warn('[WebAgent] Direct JSON parse failed, trying regex extraction');
  }
  
  // Try regex-based extraction
  try {
    const actionMatch = cleanedResponse.match(/"action"\s*:\s*({[^}]+})/);
    const completedMatch = cleanedResponse.match(/"isCompleted"\s*:\s*(true|false)/);
    const confidenceMatch = cleanedResponse.match(/"confidence"\s*:\s*([\d.]+)/);
    const answerMatch = cleanedResponse.match(/"finalAnswer"\s*:\s*"([^"]*?)"/);
    
    if (actionMatch) {
      const action = JSON.parse(actionMatch[1]);
      return {
        action,
        isCompleted: completedMatch ? completedMatch[1] === 'true' : false,
        confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0,
        finalAnswer: answerMatch ? answerMatch[1] : ''
      };
    }
  } catch (e) {
    console.warn('[WebAgent] Regex extraction failed');
  }
  
  // Last resort: throw error to trigger fallback
  throw new Error('Failed to parse AI response after all strategies');
}

/**
 * Generate intelligent fallback action based on context
 */
function generateIntelligentFallback(pageState, task, allSteps) {
  const lastActions = allSteps.slice(-3).map(step => step.action?.type);
  
  // If we've scrolled multiple times, try extraction
  if (lastActions.filter(action => action === 'scroll').length >= 2) {
    return {
      action: {
        type: 'extract',
        target: 'body',
        value: task,
        reasoning: 'Multiple scrolls completed, attempting data extraction from visible content'
      },
      isCompleted: false,
      confidence: 0.3,
      finalAnswer: ''
    };
  }
  
  // If page has loading indicators, wait
  if (pageState.metrics?.hasLoadingIndicators) {
    return {
      action: {
        type: 'wait',
        target: 'body',
        value: '3000',
        reasoning: 'Loading indicators detected, waiting for content to load'
      },
      isCompleted: false,
      confidence: 0.5,
      finalAnswer: ''
    };
  }
  
  // Default to intelligent scroll
  return {
    action: {
      type: 'scroll',
      target: 'body',
      value: 'down',
      reasoning: 'Intelligent fallback: scrolling to reveal more content'
    },
    isCompleted: false,
    confidence: 0.2,
    finalAnswer: ''
  };
}

/**
 * Executes a single action on the page.
 */
async function executeAction(page, action) {
  try {
    const { type, target, value } = action;
    console.log(`[WebAgent] Executing ${type} action on "${target}"${value ? ` with value "${value}"` : ''}`);
    
    await page.waitForTimeout(500); // Small delay for stability

    switch (type) {
      case 'click':
        // Enhanced click with better error handling
        try {
          await page.waitForSelector(target, { timeout: 5000 });
          await page.click(target, { timeout: 10000 });
          await page.waitForTimeout(1000); // Wait for any navigation or dynamic content
        } catch (e) {
          // Try alternative click methods
          await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            if (element) element.click();
            else throw new Error(`Element not found: ${selector}`);
          }, target);
        }
        break;
        
      case 'fill':
        await page.waitForSelector(target, { timeout: 5000 });
        await page.fill(target, value, { timeout: 10000 });
        await page.waitForTimeout(500);
        break;
        
      case 'navigate':
        await page.goto(value || target, { 
          waitUntil: 'domcontentloaded', 
          timeout: 30000 
        });
        await page.waitForTimeout(2000);
        break;
        
      case 'scroll':
        if (value === 'down' || !value) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        } else if (value === 'up') {
          await page.evaluate(() => window.scrollBy(0, -window.innerHeight));
        } else if (target && target !== 'body') {
          // Scroll to specific element
          await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            if (element) element.scrollIntoView({ behavior: 'smooth' });
          }, target);
        }
        await page.waitForTimeout(1000); // Wait for scroll to complete
        break;
        
      case 'wait':
        const waitTime = parseInt(value) || 2000;
        await page.waitForTimeout(Math.min(waitTime, 10000)); // Cap at 10 seconds
        break;
        
      case 'extract':
        // Unified extraction function that adapts to any website
        console.log(`[WebAgent] Performing intelligent extraction on "${target}" with value:`, value);
        const extractionResult = await performIntelligentExtraction(page, target, value);
        
        return { 
          success: true, 
          message: 'Data extraction completed', 
          data: extractionResult 
        };
        
      default:
        throw new Error(`Unsupported action type: ${type}`);
    }
    
    return { 
      success: true, 
      message: `${type} action executed successfully`,
      newUrl: page.url() 
    };
    
  } catch (error) {
    console.error(`[WebAgent] Action execution failed: ${error.message}`);
    return { 
      success: false, 
      error: error.message,
      actionType: action.type,
      target: action.target 
    };
  }
}

/**
 * Unified intelligent extraction function that adapts to any website structure
 * Handles both structured field mappings and general data extraction
 */
async function performIntelligentExtraction(page, containerSelector, extractionConfig) {
  try {
    const extractedData = await page.evaluate(({ containerSel, config }) => {
      console.log('Starting intelligent extraction with config:', config);
      
      // Parse string-based field mappings (e.g., "title: .gs_rt; authors_year: .gs_a")
      let parsedConfig = config;
      if (typeof config === 'string' && config.includes(':')) {
        parsedConfig = {};
        const pairs = config.split(';').map(pair => pair.trim()).filter(pair => pair.length > 0);
        pairs.forEach(pair => {
          const [key, selector] = pair.split(':').map(s => s.trim());
          if (key && selector) {
            parsedConfig[key] = selector;
          }
        });
        console.log('Parsed string config into object:', parsedConfig);
      }
      
      // Helper function to safely get text content
      const getTextContent = (element) => {
        if (!element) return '';
        return element.textContent?.trim() || 
               element.value?.trim() || 
               element.getAttribute('alt')?.trim() || 
               element.getAttribute('title')?.trim() || 
               element.getAttribute('aria-label')?.trim() || '';
      };
      
      // Helper function to safely get attribute
      const getAttribute = (element, attr) => {
        return element?.getAttribute(attr)?.trim() || '';
      };
      
      // Helper function to find elements using multiple selectors
      const findElementBySelectors = (container, selectors) => {
        if (typeof selectors === 'string') {
          selectors = [selectors];
        }
        
        for (const selector of selectors) {
          try {
            const element = container.querySelector(selector);
            if (element) return element;
          } catch (e) {
            console.warn(`Invalid selector: ${selector}`);
          }
        }
        return null;
      };
      
      // Step 1: Find container elements
      let containers = [];
      
      try {
        containers = Array.from(document.querySelectorAll(containerSel));
        console.log(`Found ${containers.length} containers using selector: ${containerSel}`);
      } catch (e) {
        console.warn(`Invalid container selector: ${containerSel}`);
        containers = [document.body]; // Fallback to body
      }
      
      if (containers.length === 0) {
        containers = [document.body]; // Fallback to body
      }
      
      const results = [];
      
      // Step 2: Process each container
      containers.forEach((container, containerIndex) => {
        const item = {
          index: containerIndex + 1,
          containerSelector: containerSel
        };
        
        // Step 3: Handle different extraction configurations
        if (typeof parsedConfig === 'object' && parsedConfig !== null && !Array.isArray(parsedConfig)) {
          // Structured field extraction (e.g., {title: "h3", url: "a", snippet: "p"})
          console.log('Using structured field extraction');
          
          Object.entries(parsedConfig).forEach(([fieldName, fieldSelectors]) => {
            const element = findElementBySelectors(container, fieldSelectors);
            
            if (element) {
              // For links, get href; for images, get src; for others, get text
              if (element.tagName.toLowerCase() === 'a') {
                item[fieldName] = element.href || getTextContent(element);
                if (fieldName === 'url' || fieldName === 'link' || fieldName === 'href') {
                  item[`${fieldName}_text`] = getTextContent(element);
                }
              } else if (element.tagName.toLowerCase() === 'img') {
                item[fieldName] = element.src || getAttribute(element, 'data-src');
                item[`${fieldName}_alt`] = getAttribute(element, 'alt');
              } else {
                item[fieldName] = getTextContent(element);
              }
            }
          });
          
        } else {
          // Smart auto-detection extraction
          console.log('Using smart auto-detection extraction');
          
          // Common patterns for different types of content
          const patterns = {
            // Titles/headings
            title: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', '[class*="title"]', '[class*="heading"]', '[data-testid*="title"]'],
            
            // Links
            link: ['a[href]', '[class*="link"]'],
            
            // Descriptions/snippets
            description: ['p', '.description', '[class*="description"]', '[class*="snippet"]', '[class*="summary"]'],
            
            // Prices
            price: ['[class*="price"]', '[data-testid*="price"]', '[class*="cost"]', '[class*="amount"]'],
            
            // Ratings
            rating: ['[class*="rating"]', '[class*="star"]', '[aria-label*="star"]', '[aria-label*="rating"]'],
            
            // Images
            image: ['img', '[class*="image"]', '[class*="photo"]', '[class*="picture"]'],
            
            // Dates
            date: ['[class*="date"]', '[class*="time"]', 'time', '[datetime]'],
            
            // Authors/sources
            author: ['[class*="author"]', '[class*="user"]', '[class*="name"]', '[class*="source"]']
          };
          
          // Apply patterns to find content
          Object.entries(patterns).forEach(([fieldName, selectors]) => {
            const element = findElementBySelectors(container, selectors);
            
            if (element) {
              const text = getTextContent(element);
              if (text && text.length > 0) {
                if (element.tagName.toLowerCase() === 'a' && element.href) {
                  item[fieldName] = text;
                  item[`${fieldName}_url`] = element.href;
                } else if (element.tagName.toLowerCase() === 'img') {
                  item[fieldName] = element.src || getAttribute(element, 'data-src');
                  item[`${fieldName}_alt`] = getAttribute(element, 'alt');
                } else {
                  item[fieldName] = text;
                }
              }
            }
          });
          
          // Special extraction for numeric values (prices, ratings, counts)
          const allText = getTextContent(container);
          
          // Extract prices (₹, $, €, etc.)
          const priceMatch = allText.match(/[₹$€£¥₩]\s*[\d,]+(?:\.[\d]{1,2})?|\d+[,.]?\d*\s*[₹$€£¥₩]/);
          if (priceMatch && !item.price) {
            item.price = priceMatch[0].trim();
            const numericMatch = priceMatch[0].match(/[\d,]+(?:\.[\d]{1,2})?/);
            if (numericMatch) {
              item.price_numeric = parseFloat(numericMatch[0].replace(/,/g, ''));
            }
          }
          
          // Extract ratings (X.X/5, X.X stars, X.X★)
          const ratingMatch = allText.match(/(\d+\.?\d*)\s*(?:\/\s*5|stars?|★|out\s+of\s+5)/i);
          if (ratingMatch && !item.rating) {
            item.rating = parseFloat(ratingMatch[1]);
          }
          
          // Extract counts (review counts, view counts, etc.)
          const countMatch = allText.match(/(\d+[,\d]*)\s*(?:reviews?|ratings?|views?|likes?|comments?)/i);
          if (countMatch) {
            const countType = countMatch[0].toLowerCase().includes('review') ? 'review_count' : 'count';
            item[countType] = parseInt(countMatch[1].replace(/,/g, ''));
          }
        }
        
        // Step 4: Quality check - only include items with meaningful content
        const hasContent = Object.values(item).some(value => 
          typeof value === 'string' && value.length > 2 ||
          typeof value === 'number' && value > 0
        );
        
        if (hasContent && Object.keys(item).length > 2) { // More than just index and containerSelector
          results.push(item);
        }
      });
      
      // Step 5: Return structured result
      const result = {
        items: results,
        totalFound: containers.length,
        totalExtracted: results.length,
        pageUrl: window.location.href,
        pageTitle: document.title,
        extractionTime: new Date().toISOString(),
        extractionType: typeof parsedConfig === 'object' && parsedConfig !== null ? 'structured' : 'auto-detection',
        containerSelector: containerSel
      };
      
      console.log(`Intelligent extraction complete: ${results.length}/${containers.length} items extracted`);
      
      return result;
      
    }, { containerSel: containerSelector, config: extractionConfig });
    
    // Post-process the results
    if (extractedData.items && extractedData.items.length > 0) {
      console.log(`[WebAgent] Successfully extracted ${extractedData.items.length} items`);
      
      // For backward compatibility with existing code that expects 'products'
      if (extractionConfig && typeof extractionConfig === 'string' && 
          (extractionConfig.toLowerCase().includes('product') || 
           extractionConfig.toLowerCase().includes('phone') ||
           extractionConfig.toLowerCase().includes('shop'))) {
        extractedData.products = extractedData.items;
      }
      
      return extractedData;
    } else {
      console.log('[WebAgent] No items extracted');
      return {
        items: [],
        products: [], // For backward compatibility
        totalFound: 0,
        totalExtracted: 0,
        pageUrl: await page.url(),
        error: 'No items could be extracted with the given selector and configuration'
      };
    }
    
  } catch (error) {
    console.error(`[WebAgent] Intelligent extraction failed: ${error.message}`);
    return {
      error: error.message,
      items: [],
      products: [], // For backward compatibility
      totalFound: 0,
      totalExtracted: 0,
      pageUrl: await page.url(),
      extractionTime: new Date().toISOString()
    };
  }
}

/**
 * Generates a partial summary if the task is not completed.
 */
async function generatePartialResult(task, allSteps) {
  // Check if any steps contained partial data
  const extractionSteps = allSteps.filter(step => {
    const data = step.result?.data;
    return data && (
      (data.items && data.items.length > 0) || 
      (data.products && data.products.length > 0)
    );
  });
  
  if (extractionSteps.length > 0) {
    // Return the best extraction attempt
    const bestExtraction = extractionSteps.reduce((best, current) => {
      const currentCount = current.result.data.items?.length || current.result.data.products?.length || 0;
      const bestCount = best.result.data.items?.length || best.result.data.products?.length || 0;
      return currentCount > bestCount ? current : best;
    });
    
    const itemCount = bestExtraction.result.data.items?.length || bestExtraction.result.data.products?.length || 0;
    
    return {
      status: 'Partially Complete',
      extractedData: bestExtraction.result.data,
      summary: `Partial success: Found ${itemCount} items. Task could not be fully completed within the iteration limit.`,
      steps: allSteps.length,
      completedIterations: allSteps.length
    };
  }
  
  // Fallback to LLM summary if no extraction data
  const summaryPrompt = `Based on the following web automation actions, provide a concise summary of what was accomplished and why the task could not be completed.
  
  Task: "${task}"
  Total Steps: ${allSteps.length}
  Actions Performed: ${JSON.stringify(allSteps.map(s => ({
    iteration: s.iteration,
    action: s.action?.type,
    target: s.action?.target,
    success: s.result?.success,
    url: s.pageUrl
  })), null, 2)}
  
  Focus on what progress was made and what prevented completion.`;

  try {
    const summary = await callLangChain(
      'You are a task analysis expert. Provide a clear, concise summary of the web automation attempt.', 
      summaryPrompt,
      { maxTokens: 500, temperature: 0.3 }
    );
    
    return {
      status: 'Incomplete',
      summary,
      steps: allSteps.length,
      completedIterations: allSteps.length,
      lastUrl: allSteps.length > 0 ? allSteps[allSteps.length - 1].pageUrl : 'Unknown'
    };
  } catch (e) {
    return {
      status: 'Incomplete',
      summary: `Task could not be completed after ${allSteps.length} attempts. The web agent was unable to extract the required data from the target website.`,
      steps: allSteps.length,
      error: 'Summary generation failed'
    };
  }
}

module.exports = { WebAgent };