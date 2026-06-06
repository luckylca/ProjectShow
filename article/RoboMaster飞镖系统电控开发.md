# RoboMaster 飞镖系统底层电控算法开发

## 1. 工作背景

研发一套具备精确位置伺服、稳定发射控制及高可复用性的嵌入式底层控制框架

**核心技术栈**：STM32 / FreeRTOS / C语言面向对象开发 / PID与前馈复合控制算法

------



## 2. 核心实现

### 2.1 高可复用嵌入式软件架构设计

针对传统单片机代码耦合度高、维护困难的问题，从底层重构了软件框架，实现高度解耦：

- **三层解耦框架**：构建 BSP(硬件抽象层) -> Module(模块层) -> Application(应用层) 体系，规范并统一外设接口。

  #### bsp封装（针对芯片内部已有的功能的封装）

  | 功能类别   | 模块                    |
  | ---------- | ----------------------- |
  | 通信类外设 | usart  spi  i2c can usb |
  | 日志       | log flash               |
  | 功能型     | gpio(exti) pwm adc      |
  | 辅助       | dwt                     |

  #### module封装（对额外的中间层的工具进行封装）

  | 功能类别 | 模块                                                         |
  | -------- | ------------------------------------------------------------ |
  | 电机     | DJI、DM、瓴控LK、步进电机、舵机                              |
  | 通信     | 多板通信(基于CAN)、裁判系统数据/UI/多机、vofa协议、DT7-DR16遥控器 |
  | 功能模块 | 蜂鸣器、oled、bmi088、ist8310、超级电容、TFminiPlus          |
  | 应用支持 | 常用算法库、守护线程、消息中心                               |

  #### application封装（宏观的逻辑和算法）

  作为命令发布主体的 `robot_cmd` ，用于调整飞镖发射yaw的 `gimbal` ，用于控制两个蓄力电机的 `chassis` ，控制发射和换弹的 `shoot` 。

  

  在日常写代码中，只需要维护 `application` 层的宏观逻辑，如果需要添加新功能，则新建一个` module` 层的文件，对 `application` 层暴露出初始化和调用的函数即可。

  

  ```
  Motor_Init_Config_s yaw_config = {
      .can_init_config =
          {
              .can_handle = &hcan1,
              .tx_id = 7,
          },
      .controller_param_init_config =
          {
              .angle_PID =
                  {
                      .Kp = 10, 
                      .Ki = 0,
                      .Kd = 0,
                      .MaxOut = 80000,
                  },
              .speed_PID =
                  {
                      .Kp = 5, 
                      .Ki = 1,  
                      .Kd = 0,
                      .Improve = PID_Integral_Limit,
                      .IntegralLimit = 5000,
                      .MaxOut = 10000,
                  },
              .current_PID =
                  {
                      .Kp = 0.5, // 0.7
                      .Ki = 0.1, // 0.1
                      .Kd = 0,
                      .Improve = PID_Integral_Limit,
                      .IntegralLimit = 5000,
                      .MaxOut = 5000,
                  },
          },
      .controller_setting_init_config =
          {
              .angle_feedback_source = MOTOR_FEED,
              .speed_feedback_source = MOTOR_FEED,
              .outer_loop_type =
                  SPEED_LOOP,
              .close_loop_type = CURRENT_LOOP | SPEED_LOOP | ANGLE_LOOP,
              .motor_reverse_flag =
                  MOTOR_DIRECTION_NORMAL, //  MOTOR_DIRECTION_NORMAL
                                          //  MOTOR_DIRECTION_REVERSE
          },
      .motor_type = M2006,
      .storage_type = NO_STORAGE};
  yaw_motor = DJIMotorInit(&yaw_config);
  
  DJIMotorEnable(yaw_motor);
  DJIMotorOuterLoop(yaw_motor, ANGLE_LOOP);
  DJIMotorSetRef(yaw_motor, gimbal_cmd_recv.yaw); 
  ```

  

- **C风格面向对象**：采用 XXXInstance + Register 模式实现模块实例化，提升代码复用率。

  ```
  static DJIMotorInstance *dji_motor_instance[DJI_MOTOR_CNT] = {NULL};
  DJIMotorInstance *DJIMotorInit(Motor_Init_Config_s *config)
  {
      DJIMotorInstance *instance = (DJIMotorInstance *)malloc(sizeof(DJIMotorInstance));
      memset(instance, 0, sizeof(DJIMotorInstance));
      // motor basic setting 电机基本设置
      instance->motor_type = config->motor_type;
      instance->motor_settings = config->controller_setting_init_config;
      // 初始化滤波器
      DJIMotorFilterInit(&instance->measure);
      // motor controller init 电机控制器初始化
      PIDInit(&instance->motor_controller.current_PID, &config->controller_param_init_config.current_PID);
      PIDInit(&instance->motor_controller.speed_PID, &config->controller_param_init_config.speed_PID);
      PIDInit(&instance->motor_controller.angle_PID, &config->controller_param_init_config.angle_PID);
      instance->motor_controller.other_angle_feedback_ptr = config->controller_param_init_config.other_angle_feedback_ptr;
      instance->motor_controller.other_speed_feedback_ptr = config->controller_param_init_config.other_speed_feedback_ptr;
      instance->motor_controller.current_feedforward_ptr = config->controller_param_init_config.current_feedforward_ptr;
      instance->motor_controller.speed_feedforward_ptr = config->controller_param_init_config.speed_feedforward_ptr;
      // 后续增加电机前馈控制器(速度和电流)
      // 电机分组,因为至多4个电机可以共用一帧CAN控制报文
      MotorSenderGrouping(instance, &config->can_init_config);
      // 注册电机到CAN总线
      config->can_init_config.can_module_callback = DecodeDJIMotor; // set callback
      config->can_init_config.id = instance;                        // set id,eq to address(it is identity)
      instance->motor_can_instance = CANRegister(&config->can_init_config);
      // 注册守护线程
      Daemon_Init_Config_s daemon_config = {
          .callback = DJIMotorLostCallback,
          .owner_id = instance,
          .reload_count = 2, // 20ms未收到数据则丢失
      };
      instance->daemon = DaemonRegister(&daemon_config);
  
      DJIMotorEnable(instance);
      dji_motor_instance[idx++] = instance;
      return instance;
  }
  
  void DJIMotorControl()
  {
      // 直接保存一次指针引用从而减小访存的开销,同样可以提高可读性
      uint8_t group, num; // 电机组号和组内编号
      int16_t set;        // 电机控制CAN发送设定值
      DJIMotorInstance *motor;
      Motor_Control_Setting_s *motor_setting; // 电机控制参数
      Motor_Controller_s *motor_controller;   // 电机控制器
      DJI_Motor_Measure_s *measure;           // 电机测量值
      float pid_measure, pid_ref;             // 电机PID测量值和设定值
  
      // 遍历所有电机实例,进行串级PID的计算并设置发送报文的值
      for (size_t i = 0; i < idx; ++i)
      { // 减小访存开销,先保存指针引用
          motor = dji_motor_instance[i];
          motor_setting = &motor->motor_settings;
          motor_controller = &motor->motor_controller;
          measure = &motor->measure;
          pid_ref = motor_controller->pid_ref; // 保存设定值,防止motor_controller->pid_ref在计算过程中被修改
          if (motor_setting->motor_reverse_flag == MOTOR_DIRECTION_REVERSE)
              pid_ref *= -1; // 设置反转
          // 计算位置环,只有启用位置环且外层闭环为位置时会计算速度环输出
          if ((motor_setting->close_loop_type & ANGLE_LOOP) && motor_setting->outer_loop_type == ANGLE_LOOP)
          {
              if (motor_setting->angle_feedback_source == OTHER_FEED)
                  pid_measure = *motor_controller->other_angle_feedback_ptr;
              else
                  pid_measure = measure->total_angle; // MOTOR_FEED,对total angle闭环,防止在边界处出现突跃
              // 更新pid_ref进入下一个环
              pid_ref = PIDCalculate(&motor_controller->angle_PID, pid_measure, pid_ref);
          }
  
          // 计算速度环,(外层闭环为速度或位置)且(启用速度环)时会计算速度环
  
          if (motor->stop_flag == MOTOR_STOP)
          {
              pid_ref = 0;
          }
          else
          {
              // 计算电流环,目前只要启用了电流环就计算,不管外层闭环是什么,并且电流只有电机自身传感器的反馈
          }
  
          // 获取最终输出
          set = (int16_t)pid_ref;
          // 分组填入发送数据
          group = motor->sender_group;
          num = motor->message_num;
          sender_assignment[group].tx_buff[2 * num] = (uint8_t)(set >> 8);         // 低八位
          sender_assignment[group].tx_buff[2 * num + 1] = (uint8_t)(set & 0x00ff); // 高八位
  
          // 双重保险: 停机时保持发送零电流
          if (motor->stop_flag == MOTOR_STOP)
              memset(sender_assignment[group].tx_buff + 2 * num, 0, sizeof(uint16_t));
      }
      
  	//发送can数据
  }
  ```

  

- **硬件灵活适配**：引入条件编译，一套代码即可兼容单板/双板硬件配置，大幅提升跨平台移植效率，使用一个 `robot_def.h` 文件存储所有的需要修改的参数，用宏定义代替，可以快速修改参数。

  ```
  #define VIRSION // 使用视觉数据进行辅助瞄准
  // #define REFEREE //接入裁判系统
  
  /* 机器人重要参数定义,注意根据不同机器人进行修改,浮点数需要以.0或f结尾,无符号以u结尾 */
  
  #define BANJI_OPEN_ANGLE 0.098f    // 扳机舵机打开角度
  #define BANJI_CLOSE_ANGLE 0.082f // 扳机舵机关闭角度
  #define GRIPPER_1_LAY_ANGLE 0.111f // 夹爪1放置角度
  #define GRIPPER_1_NORMAL_ANGLE 0.075f // 夹爪1正常角度
  ```

  

### 2.2 极低开销的状态机

使用按位来处理每一个标志位，并且在面临多种状态结合起来一起判断的时候，采用Mask遮罩的方式处理，使用语法糖宏快速处理标志位

```
#include "stdint.h"

#define FLAG_TRIGGER_AT_LOAD_POS (1 << 0)  // 扳机处于“接镖/装弹”位置
#define FLAG_TRIGGER_AT_SHOOT_POS (1 << 1) // 扳机处于“蓄能/发射”位置
#define FLAG_RELOAD_ROTATED (1 << 2)       // 旋转换弹电机到位
                            
// [发射条件]：扳机必须顶出发射位 + 蓄力/反弹电机OK + 云台瞄准OK + 且飞镖已经装进去了+视觉到位
#define MASK_READY_TO_FIRE (FLAG_TRIGGER_AT_SHOOT_POS |                       \
                            FLAG_L_CHARGE_REACHED | FLAG_R_CHARGE_REACHED |   \
                            FLAG_L_REBOUND_REACHED | FLAG_R_REBOUND_REACHED | \
                            FLAG_GIMBAL_AIMED |                               \
                            FLAG_DART_DROPPED | \
                            FLAG_IN_PLACE)//准备发射标志位

// 语法糖宏
#define DART_SET_BIT(idx, flag)   (DartSys.statusFlags[idx] |= (flag))
#define DART_CHECK_MASK(idx, mask) ((DartSys.statusFlags[idx] & (mask)) == (mask))
```



### 2.3 基于重力补偿的高精度伺服控制算法

在换弹过程中负载不均匀的情况下，通过对换弹部分的结构进行建模，读取电机角度，计算旋转换弹电机的前馈力矩，并且通过MIT控制协议发送给DM6220电机

------



## 3. 工作成果

<video src="C:\Users\lucky\Desktop\ProjectShow\asset\换弹.mp4"></video>

