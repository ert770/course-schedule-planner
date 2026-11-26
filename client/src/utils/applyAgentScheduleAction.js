export async function applyAgentScheduleAction(action, operations) {
  const name = action.course?.name ?? `班次 ${action.sectionId}`;
  const change = async (run, success) => {
    const result = await run();
    return result?.success
      ? { success: true, message: success }
      : { success: false, message: result?.message || '操作未完成，已保留目前課表。' };
  };

  switch (action.action) {
    case 'add':
      return change(() => operations.addCourse(action.course), `已將「${name}」加入課表，重排與切換方案時會保留。`);
    case 'remove':
      return change(() => operations.removeCourse(action.sectionId, { feedbackReason: action.reason }),
        `已從課表移除「${name}」，並加入長期避開。`);
    case 'swap':
      return change(() => operations.applyCourseSwap({ removeSectionId: action.sectionId, addCourse: action.target }),
        `已將「${name}」換成「${action.target.name}」。`);
    case 'lock':
    case 'unlock':
      return change(() => operations.setCourseLocked(action.sectionId, action.action === 'lock'),
        action.action === 'lock' ? `已鎖定「${name}」，重排與切換方案時會保留。`
          : `已解除「${name}」的鎖定。手動加選仍會照常保留。`);
    case 'avoid':
    case 'restore': {
      const avoid = action.action === 'avoid';
      return change(() => operations.setCourseAvoidance(action.course, { avoid, scope: action.scope, reason: action.reason }),
        avoid ? `已將「${name}」加入${action.scope === 'temporary' ? '本次' : '長期'}避開。`
          : `已解除「${name}」的避開。下次排課可重新納入候選。`);
    }
    case 'watch':
    case 'unwatch': {
      const watching = action.action === 'watch';
      return change(() => operations.toggleWatchlist(action.course, watching),
        watching ? `已關注「${name}」。` : `已取消關注「${name}」。`);
    }
    case 'compare': {
      const plans = operations.plans;
      if (plans.length === 0) return { success: true, message: '目前沒有可比較的方案，請先產生課表。' };
      if (plans.length === 1) return { success: true, message: `目前只有「${plans[0].title}」一份方案。` };
      const lines = plans.map(plan => {
        const courses = [...plan.schedule, ...(plan.unscheduledCourses ?? [])];
        const names = courses.map(course => course.name).filter(Boolean).join('、');
        return `- **${plan.title}**${plan.id === operations.selectedPlanId ? '（目前）' : ''}，${courses.length} 門、${plan.totalCredits ?? 0} 學分${names ? `。課程 ${names}` : ''}`;
      });
      return { success: true, message: ['目前的課表方案', ...lines, '切換時會保留手動加選和鎖定課程。'].join('\n') };
    }
    case 'switch': {
      const plan = operations.plans.find(item => item.id === action.variantId);
      if (!plan) return { success: false, message: '這個方案已不可用，已保留目前課表。' };
      return change(() => operations.selectPlan(action.variantId),
        `已切換到「${plan.title}」，手動加選和鎖定課程仍保留。`);
    }
    case 'check': {
      if (action.empty) return { success: true, message: '目前課表沒有課程可檢查。' };
      const issues = action.issues ?? [];
      const message = action.valid
        ? `課表已通過可驗證的限制檢查，共 ${action.credits} 學分。缺少資料的資格條件仍待確認。`
        : [`目前課表共 ${action.credits} 學分，有 ${issues.length} 項問題。`, ...issues.map(reason => `- ${reason}`)].join('\n');
      return { success: true, message };
    }
    case 'feedback':
      return operations.applyFeedback(action);
    default:
      return { success: false, message: '目前無法處理這個課表操作。' };
  }
}
