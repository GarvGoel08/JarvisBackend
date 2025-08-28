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
          // If extraction was successful and returned meaningful data
          if (actionResult.data.products && actionResult.data.products.length > 0) {
            taskCompleted = true;
            finalResult = {
              status: 'Completed',
              extractedData: actionResult.data,
              summary: `Successfully extracted ${actionResult.data.products.length} products from ${actionResult.data.pageUrl}`
            };
            console.log(`[WebAgent] Data extraction completed with ${actionResult.data.products.length} items`);
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
        const finalExtractionResult = await extractDataFromPage(page, task);
        
        if (finalExtractionResult.products && finalExtractionResult.products.length > 0) {
          taskCompleted = true;
          finalResult = {
            status: 'Completed via final extraction',
            extractedData: finalExtractionResult,
            summary: `Extracted ${finalExtractionResult.products.length} products in final attempt`
          };
          console.log(`[WebAgent] Final extraction successful: ${finalExtractionResult.products.length} products found`);
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
        // New extraction action type
        const extractionResult = await extractDataFromPage(page, value || target);
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
 * Extract structured data from the current page
 */
async function extractDataFromPage(page, query) {
  try {
    const extractedData = await page.evaluate((taskQuery) => {
      // Enhanced data extraction based on common e-commerce patterns
      const products = [];
      
      // Common product container selectors (prioritized by reliability)
      const productSelectors = [
        // Amazon-specific selectors (most reliable)
        'div[data-component-type="s-search-result"]',
        '.s-result-item',
        '.s-search-result',
        
        // Generic e-commerce selectors
        '[data-component-type*="product"]',
        '.product-item',
        '.product-card',
        '[data-testid*="product"]',
        
        // Fallback selectors
        'div[class*="result-item"]',
        'div[class*="product"]',
        '.sg-col-inner'
      ];
      
      let productContainers = [];
      
      // Find product containers using the most reliable selector first
      for (const selector of productSelectors) {
        try {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            productContainers = Array.from(elements);
            console.log(`Found ${elements.length} products using selector: ${selector}`);
            break;
          }
        } catch (e) {
          console.warn(`Invalid selector: ${selector}`);
        }
      }
      
      // If no specific product containers, look for repeated patterns
      if (productContainers.length === 0) {
        const allDivs = document.querySelectorAll('div[class*="result"], div[class*="item"], div[class*="product"], div[class*="card"]');
        productContainers = Array.from(allDivs).filter(div => {
          const hasPrice = div.querySelector('[class*="price"], [class*="cost"], .a-price');
          const hasTitle = div.querySelector('h1, h2, h3, h4, h5, a[href*="product"], a[title]');
          return hasPrice || hasTitle;
        });
      }
      
      // Extract data from each product container
      productContainers.forEach((container, index) => {
        if (index >= 15) return; // Limit to first 15 products
        
        const product = {
          index: index + 1,
          container: container.className || ''
        };
        
        // Extract title/name - Amazon specific selectors first
        const titleSelectors = [
          // Amazon-specific title selectors
          'h2.a-size-mini a.a-link-normal',
          'h2 a.a-link-normal span',
          '.a-size-base-plus',
          '.a-size-medium.a-color-base',
          
          // Generic selectors
          'h1 a, h2 a, h3 a, h4 a, h5 a',
          '[data-cy="product-title"] a',
          'a[href*="dp/"]',  // Amazon product pages
          'a[href*="product"]',
          '.s-link-style a',
          'a[title]',
          'h1, h2, h3, h4, h5',
          '.product-title',
          '[class*="title"]'
        ];
        
        for (const selector of titleSelectors) {
          try {
            const titleElement = container.querySelector(selector);
            if (titleElement) {
              let name = titleElement.textContent?.trim() || titleElement.title?.trim() || titleElement.getAttribute('aria-label')?.trim() || '';
              let link = titleElement.href || '';
              
              // If it's a span inside a link, get the parent link
              if (!link && titleElement.parentElement && titleElement.parentElement.href) {
                link = titleElement.parentElement.href;
              }
              
              if (name && name.length > 5) { // Ensure meaningful name
                product.name = name;
                product.link = link;
                break;
              }
            }
          } catch (e) {
            console.warn(`Selector failed: ${selector}`, e.message);
          }
        }
        
        // Extract brand (often in title or separate element)
        const brandSelectors = [
          '[class*="brand"]',
          '.brand',
          'span[dir="auto"]:first-child'
        ];
        
        for (const selector of brandSelectors) {
          const brandElement = container.querySelector(selector);
          if (brandElement) {
            product.brand = brandElement.textContent?.trim() || '';
            if (product.brand) break;
          }
        }
        
        // Extract from title if brand not found separately
        if (!product.brand && product.name) {
          const commonBrands = ['Samsung', 'iPhone', 'OnePlus', 'Xiaomi', 'Realme', 'Oppo', 'Vivo', 'Apple', 'Google', 'Nothing'];
          const foundBrand = commonBrands.find(brand => 
            product.name.toLowerCase().includes(brand.toLowerCase())
          );
          if (foundBrand) product.brand = foundBrand;
        }
        
        // Extract price - Amazon specific selectors
        const priceSelectors = [
          // Amazon price structure
          '.a-price .a-offscreen',  // Hidden but complete price
          '.a-price-whole',         // Whole number part
          '.a-price-range .a-offscreen', // Price range
          
          // Alternative Amazon price selectors
          '.a-price',
          '.a-price-current',
          
          // Generic price selectors
          '[class*="price-current"]',
          '[class*="price-now"]',
          '[class*="price"]',
          '.price',
          '[data-testid*="price"]'
        ];
        
        for (const selector of priceSelectors) {
          try {
            const priceElement = container.querySelector(selector);
            if (priceElement) {
              let priceText = priceElement.textContent?.trim() || '';
              
              // Handle Amazon's price structure (whole + fraction)
              if (selector === '.a-price-whole') {
                const fractionElement = container.querySelector('.a-price-fraction');
                if (fractionElement) {
                  priceText += '.' + fractionElement.textContent?.trim();
                }
              }
              
              // Extract numeric price
              const priceMatch = priceText.match(/[\d,]+(?:\.[\d]{2})?/);
              if (priceMatch) {
                product.price = priceText;
                product.priceNumeric = parseFloat(priceMatch[0].replace(/,/g, ''));
                break;
              }
            }
          } catch (e) {
            console.warn(`Price selector failed: ${selector}`, e.message);
          }
        }
        
        // Extract rating - Amazon specific
        const ratingSelectors = [
          // Amazon rating selectors
          '.a-icon-alt',
          '.a-star-alt',
          'span[aria-label*="out of 5 stars"]',
          'span[aria-label*="star"]',
          
          // Generic rating selectors
          '[class*="rating"]',
          '.rating',
          '[aria-label*="rating"]',
          '[data-testid*="rating"]'
        ];
        
        for (const selector of ratingSelectors) {
          try {
            const ratingElement = container.querySelector(selector);
            if (ratingElement) {
              const ratingText = ratingElement.textContent || ratingElement.getAttribute('aria-label') || ratingElement.title || '';
              const ratingMatch = ratingText.match(/([\d.]+)\s*(?:out\s*of\s*5|stars?|\/5)?/i);
              if (ratingMatch) {
                product.rating = parseFloat(ratingMatch[1]);
                break;
              }
            }
          } catch (e) {
            console.warn(`Rating selector failed: ${selector}`, e.message);
          }
        }
        
        // Extract review count - Amazon specific
        const reviewSelectors = [
          // Amazon review count selectors
          'a[href*="#customerReviews"]',
          '.a-link-normal[href*="reviews"]',
          'span[aria-label*="review"]',
          
          // Generic review selectors
          'a[href*="reviews"]',
          '[class*="review"]',
          '.review-count',
          '[data-testid*="review"]'
        ];
        
        for (const selector of reviewSelectors) {
          try {
            const reviewElement = container.querySelector(selector);
            if (reviewElement) {
              const reviewText = reviewElement.textContent || reviewElement.getAttribute('aria-label') || '';
              const reviewMatch = reviewText.match(/([\d,]+)\s*(?:reviews?|ratings?)?/i);
              if (reviewMatch) {
                product.reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));
                break;
              }
            }
          } catch (e) {
            console.warn(`Review selector failed: ${selector}`, e.message);
          }
        }
        
        // Extract offers/discounts
        const offerSelectors = [
          '[class*="deal"]',
          '[class*="offer"]',
          '[class*="discount"]',
          '.coupon',
          '[class*="save"]'
        ];
        
        const offers = [];
        offerSelectors.forEach(selector => {
          const offerElements = container.querySelectorAll(selector);
          offerElements.forEach(el => {
            const offerText = el.textContent?.trim();
            if (offerText && offerText.length > 0 && offerText.length < 100) {
              offers.push(offerText);
            }
          });
        });
        
        if (offers.length > 0) {
          product.offers = offers.slice(0, 3); // Limit to 3 offers
        }
        
        // Only add products with essential information and validation
        if (product.name && product.name.length > 5) {
          // Additional validation for phone products
          const nameText = product.name.toLowerCase();
          const isPhoneProduct = nameText.includes('phone') || 
                                nameText.includes('mobile') || 
                                nameText.includes('smartphone') ||
                                nameText.includes('iphone') ||
                                nameText.includes('samsung') ||
                                nameText.includes('oneplus') ||
                                nameText.includes('xiaomi') ||
                                nameText.includes('realme') ||
                                nameText.includes('oppo') ||
                                nameText.includes('vivo');
          
          // For phone search, prefer items that are actually phones
          if (taskQuery && taskQuery.toLowerCase().includes('phone')) {
            if (isPhoneProduct || product.price) {
              products.push(product);
            }
          } else {
            // For non-phone searches, add all products with names
            products.push(product);
          }
        }
      });
      
      const extractionResult = {
        products,
        totalFound: productContainers.length,
        totalExtracted: products.length,
        pageUrl: window.location.href,
        extractionTime: new Date().toISOString(),
        query: taskQuery,
        selectorsUsed: productSelectors.slice(0, 1) // First working selector
      };
      
      console.log(`Extraction complete: ${products.length}/${productContainers.length} products extracted`);
      
      return extractionResult;
      
    }, query);
    
    return extractedData;
    
  } catch (error) {
    console.error(`[WebAgent] Data extraction failed: ${error.message}`);
    return {
      error: error.message,
      products: [],
      totalFound: 0
    };
  }
}

/**
 * Generates a partial summary if the task is not completed.
 */
async function generatePartialResult(task, allSteps) {
  // Check if any steps contained partial data
  const extractionSteps = allSteps.filter(step => 
    step.result?.data && step.result.data.products && step.result.data.products.length > 0
  );
  
  if (extractionSteps.length > 0) {
    // Return the best extraction attempt
    const bestExtraction = extractionSteps.reduce((best, current) => {
      return (current.result.data.products.length > best.result.data.products.length) ? current : best;
    });
    
    return {
      status: 'Partially Complete',
      extractedData: bestExtraction.result.data,
      summary: `Partial success: Found ${bestExtraction.result.data.products.length} products. Task could not be fully completed within the iteration limit.`,
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